# Crusade Deck

A multiplayer card game for mobile browsers. 2–32 players per session, 36- or 52-card
deck. Pixel-casual style (Balatro-style) — not a literal "table with people", a virtual
round table with a "П"-shaped seating layout.

There are no rules for any specific card game in the codebase — what's implemented is
the full physical table mechanics (deck, dealing, hands, voting), on top of which game
rules can later be layered as configuration.

## Stack

- **Server**: Colyseus (Node.js, `@colyseus/schema` v2), custom accounts instead of
  Firebase.
- **Client**: React + Vite. The table is rendered by an imperative **Pixi.js v8**
  engine (not `@pixi/react` — see why below); menus and static UI are plain React,
  Framer Motion only there.
- **Auth**: custom accounts (short recovery code, no password). Firebase is scaffolded
  for later (`client/src/firebase.ts`, `server/src/auth.ts`) but not configured or used
  until keys are supplied.
- **Tests**: vitest in both packages (`npm test` in `server/` and `client/`).
- **Deploy**: see `DEPLOY.md` (Cloudflare Tunnel, no open ports) or `README.md` for a
  plain Linux server / Docker.

## Commands

```bash
cd server && npm test && npx tsc --noEmit   # 222 tests
cd client && npm test && npx tsc --noEmit   # 804 tests
cd client && npx vite build                 # production build
```

`server/vitest.config.ts` restricts the run to the `src/` directory — without it,
vitest also picked up compiled `dist/*.test.js` after `npm run build`, and two copies
of the `CardRoom` test fought over the same test port. Room tests are split by theme
(`CardRoom.deck.test.ts`, `.hands.`, `.visibility.`, `.free.`, `.votes.`, `.lifecycle.`, plus
`TestRoom.test.ts`) and share `roomHarness.ts`. Each file boots on its OWN port
(`TEST_PORTS`): vitest runs files in parallel, and `boot(server, port)` from
`@colyseus/testing` silently ignores the port when handed a ready `Server`.

The Bash tool's cwd tends to "drift" back to the repo root between calls — always `cd`
into `client/` or `server/` explicitly before `tsc`/`vitest`/`vite`.

## Table architecture (client)

`client/src/game/RoomEngine.ts` (~3400 lines, ~187 methods averaging 18 lines) is an
imperative engine: it owns a single
Pixi `Application`, the ticker, and all visual objects (`CardVisual` — plain mutable
structs, not React nodes). `RoomCanvas.tsx` is a thin React host: mounts the engine
once, then forwards each prop with `useEngineEffect` (one line per binding) and pours
everything in at once via `applyAllToEngine` right after mount. `RoomScreen.tsx`
composes room state (`room/useRoomState.ts`), server events (`room/useRoomSignals.ts`),
HTML-panel insets (`room/useInsets.ts`) and auto-dealing (`room/useAutoDeal.ts`).

Everything the engine does that is NOT engine state lives in `client/src/game/engine/`,
each with tests next to it: `constants.ts` (texture size, palette, layer zIndexes),
`cardTextures.ts` (face/back/shadow factories), `faceTextureCache.ts` (cache + warm-up
in batches), `fanGeometry.ts`, `seatChrome.ts`/`seatPaint.ts` (rules vs. drawing for
other players' seats), `zoneChrome.ts`/`zonePaint.ts` (same split for drop zones),
`collapseArrow.ts`, `scramble.ts`, `idleGate.ts`, `shadowPass.ts` (ONE shadow pass for
every layer — there used to be three competing mechanisms), `shufflePose.ts`, `shout.ts`
(the taunt bubbles «соснуть»/«сосать»).

Why not `@pixi/react`: an earlier attempt on it crashed under React StrictMode (double
mount on a canvas whose WebGL context was already destroyed → "context lost"). The
current engine creates a fresh canvas on every `mount()` instead.

The render loop sleeps when idle (`wake()`/`sleep()`) — it only draws when something is
actually moving. The sleep condition is `canSleep()` in `engine/idleGate.ts`: it lists
every active animation explicitly as a typed field. Any new continuous animation must
be added to `EngineActivity`, or it either won't play (the loop falls asleep under it)
or will keep the engine awake and burn CPU/GPU for nothing.

The engine has a safety net: `RoomEngine.test.ts` mounts it headless against a Pixi
fake (`src/test/pixiFake.ts`, `vi.mock("pixi.js")`) and checks structural invariants —
one sprite per card, no duplicates, shuffle reuses sprites, the loop sleeps and wakes,
`destroy()` leaves nothing behind. Real Pixi can't run in jsdom (no WebGL). Note the
loop only ever sleeps on the "moderate" animation profile: on "full", idle breathing
keeps it awake by design.

The deck and your own hand are the same thing with a different layout, and both are
`engine/CardPile` — order plus sprites keyed by **card identity**, not array index, so
shuffles/reorders play back for real (each card flies from its old slot to its new one)
instead of teleporting. The only difference between the two piles is two callbacks:
where card `i` rests, and what to do with a freshly created sprite (z-order for the
deck, "stay hidden while it's still flying" for the hand).

A frame reads as a table of contents: `stepPhysics` (substeps: scramble, splash,
flights, shuffle, springs) → `stepFanWiggle` → `stepDraggedCard` → `stepFlipAnim` →
`stepOverlays` → `syncScene` → `maybeSleep`. `mount` is likewise split into
`buildLayers` / `buildOverlays` / `buildShadows` / `buildHitAreas` / `bindStageEvents`.

What a finger movement MEANS is a pure function: `pressIntent` in
`engine/gestureIntent.ts` returns `wait | deal | collapse-hand | shuffle | glissando |
grab`. That's where it's easiest to get it wrong — e.g. read a slow drag as a swipe and
shuffle the deck while the player is just looking at the cards.

Game math is factored out of the engine into small pure modules in
`client/src/game/*.ts`, each with a matching `*.test.ts` — the engine just calls them
and draws the result:
- `fan.ts` — fan-arc geometry (tilt, crowding, finger hit-testing, pinned-edge spread
  while dragging).
- `flip.ts` — flipping a card/deck as an actual 180°/540° rotation (not "collapse to
  zero" — that would leave the card mirrored), tilt during the gesture, rubber-band
  resistance on a disallowed swipe.
- `deckStack.ts` — stack layout (the front card sits higher and to the right, the back
  card lower and to the left — mimicking light from the upper right), shadow.
- `deckOrder.ts` — deck permutations: `moveCard`, `shuffleOrder`, `scatterCards`
  (discarded cards are reinserted at random positions, the rest are left untouched),
  `isPermutationOf` (verifies the client didn't swap the card set).
- `swipeShuffle.ts` — swipe-gesture detection via a sliding window of velocities (not
  the last two points — otherwise a jerk at the end of a slow drag would read as a
  swipe).
- `handRow.ts` / `handView.ts` — laying out a private hand as a "row", and visibility
  rules for other players' cards.
- `collapseButton.ts` — fitting the round "collapse" button into the pocket under the
  fan's arc (the radius is computed, not a constant — otherwise the button either
  overlapped the cards or floated in mid-air on other screen sizes).
- `dealing.ts`, `dragMode.ts`, `dropZones.ts`, `selection.ts`, `barActions.ts` —
  auto-deal queue, what can be dragged in which mode, drop zones, table-element
  selection, which two buttons the bottom bar shows.
- `deckFan.ts`, `topCard.ts`, `sortHand.ts`, `zoneLabels.ts`, `taunt.ts` — board-fan
  geometry, which card of a pile is on top, sorting one's own hand, and what a drop zone
  is CALLED at rest («стол», «сброс») versus what it PROMISES mid-drag («сбросить»,
  «взять себе») — the label follows what's in the player's fingers, not just the zone.

## The board: piles on the table

In dealing (`phase: "lobby"`) the table is not marked up at all: the deck lies in the
centre and `centerZone` IS the whole table. «ГОУ!» marks the board into boxes
(`layout.ts`): `deckSlot` on the left, `centerZone` in the middle, `discardSlot` on the
right. A box that doesn't exist is `null`, and `dropZones.ts` turns that into a
zero-sized rect — so hit-testing and painting both drop it without a special case.

- **`GameState.discard`** — cards played off the table. Always face up (they've been
  played, there's nothing left to hide), the last element is the top card.
  `discard_card` puts one there from a hand, `take_discard` pulls one back out.
  `collect_hands` («Перераздача») returns both the discard and everyone's hands to the deck.
- **A board pile fans out on tap.** `BoardPile` (`engine/types.ts`) is which pile THIS
  viewer has open; it's local, unlike `GameState.deckFanned` (the dealer's blind-shuffle
  fan, which appears and vanishes for everyone at once). Any board fan opens at
  `layout.boardFanAnchor` — the centre of the play area — no matter which slot the pile
  itself sits in, so an open fan never hangs off the edge of the screen and is always
  where the eye expects it.
- **Every side element of the board shares one width** (`boardSlotWidth`): the deck slot,
  the discard slot and a side neighbour's seat read as a single column glued to the screen
  edge, and a mismatch there reads as an accident rather than as layout. The reference is
  the deck — the only one whose size is dictated by its contents. The discard keeps that
  width while empty too: the box marks the table out, it doesn't report how full it is.
- **The play zone** (`GameState.play`) is the middle box in game: a LIST OF STACKS, each
  from one card to as many as you like, everything in it face up. The server stores only
  what's in which stack — no geometry: where a stack lands on screen is `playGrid.ts`,
  from its index. Rules for it are in `server/src/playRules.ts` (`play_card`, `take_play`,
  `clear_play`); the zone is COMMON — any player may put into and take from any stack,
  including someone else's card. Turn order (a queue lock) is a later layer on top.
  - An emptied stack disappears from the list, on both sides. A grid cell with nothing in
    it takes up room and has nothing to show.
  - A stale stack index doesn't drop the action — the card just lands as a new stack. It
    already left the hand visually, and bouncing it back with no explanation is worse than
    landing it one cell over.
  - In the engine the zone is the FOURTH `CardPile`, not N of them: the stacks flatten to
    one order (`playFlat.ts`) and the layout turns a flat index back into "stack k, j-th
    from the bottom". That's what keeps sprites bound to card identity, so a card moving
    between stacks flies instead of teleporting.
  - Stacks of the zone are ordinary board piles named `play:N` (`engine/boardPile.ts`), so
    the whole board-fan mechanism came for free: a tap opens a stack at `boardFanAnchor`,
    exactly where the deck and the discard open. A CLOSED stack also gives up its top card
    to a plain drag — reaching for the fan on every move is a step too many, and the top
    card is what's usually wanted. The two gestures don't argue: move the finger and you
    drag the card, don't move it and you open the stack (the tap checks `dragHappened`).
  - What happens to the REST of a pile when a card is dragged off it depends on the pile of
    the GESTURE, not on "is the deck fanned". That used to read `!this.deckFanned`, so a
    drag out of the open discard or a zone stack (a fan that isn't the deck's) quietly
    re-laid the DECK out as n−1.
  - While a card is being dragged over the zone the table ANSWERS (`playHover.ts`): the
    stack under the finger lifts and grows (so its shadow travels further on its own —
    lift IS the excess over the resting scale), and the immediate neighbours step aside,
    opening its edges. Highlighting a border wouldn't do: the dragged card covers the very
    stack it's aiming at. Hit-testing stays on the UNSHIFTED grid, so the feedback can't
    make the target oscillate under a still finger.
  - The grid picks the column count that makes the card biggest. When space runs out the
    order of concessions is fixed: shrink the card down to `PLAY_MIN_SCALE`, and only then
    scroll. The other way round, a player would be scrolling the table at ten stacks while
    everything fits a little smaller. Room for the NEXT stack is always reserved — on a
    grid filled to the edge there would otherwise be nowhere to start one.
- Seating is a «П» (`seatLayout.ts`): at most one neighbour per side (and always either
  two of them or none), everyone else goes into the scrolling top strip. Side neighbours
  do NOT narrow the table — on a phone that would squeeze the play area into a slit;
  instead the edge boxes yield (the deck slides lower, the discard gets shorter).

## Networking: what's truth vs. just pretty

A hard split that must not blur when adding new deck-related mechanics:

1. **State is the source of truth.** Deck order and each card's facing
   (`GameState.deck`, `GameState.faceUp`) travel over the Colyseus schema. Heavy
   operations (shuffling, reordering) are computed by the client **itself**, which
   sends the finished result — the server only checks it's actually a permutation of
   the same card set (`isPermutationOf`) and does not recompute it. This is deliberate,
   for instant feedback: if the client waited for an echo with the new order, the
   animation would stutter on every round trip.
2. **`deck_fx` is decoration only.** A separate message bus for effects (flips,
   shuffling) that do NOT change state, only display for other viewers. The server
   doesn't interpret it, just validates the message shape and relays it.
3. **Revisions guard against stale echoes.** `GameState.deckRev` — only the dealer may
   write it; the number is incremented on every action. The client ignores an incoming
   state if its revision is older than what's already shown locally — otherwise its
   own delayed echo would roll the picture back and it would visibly "jitter". The same
   trick is applied to one's own hand order (`set_hand_order`): as long as the hand's
   composition hasn't changed, the client keeps the order it already sent and doesn't
   let an unrelated state patch (someone next to you hit "Ready") repaint it back to
   the unsorted server order.
4. **`ArraySchema.setAt` past the array's length APPENDS an element** rather than
   writing "into a hole" (an array of length 3 becomes length 4 after `setAt(5, x)`).
   This is the concrete source of a "deck bloated to 60 cards" bug that came up twice.
   Writing the whole deck is always done as `clear()` + a `push()` loop, never `setAt`
   across the full length.

## Visibility rules and roles

- **Open/closed hand** (`Player.handOpen`) — a per-player toggle: closed shows face-up
  to the owner, face-down to everyone else. Open shows it to everyone the same way the
  owner sees it.
- **Hidden card** (`Player.handHidden`, an imperative per-card toggle) — invisible to
  everyone but the owner, even when the hand is open.
- **Dealing is always on.** The deck lives in the centre of the table face down: no
  card's rank is visible to anyone, including the dealer, until that card ends up in
  someone's hand. Only the dealer touches the deck (shuffle, table fan, `deal_card`,
  auto-deal, `reset_deck`, `collect_hands`); the only way out of dealing is «ГОУ!» —
  free mode below — and «Перераздача» brings it back.
  There used to be a `dealMode` toggle, and switching it OFF revealed the whole deck and
  turned the table into a second, pre-cards mechanic: the deck as one object dragged
  between the centre, your hand and other players' seats, with flips. That toggle and
  that mechanic are gone — with them went `move_deck`, `flip_deck`, `flip_cards`,
  `reorder_deck` and, on the client, the whole-deck drag and the deck-in-hand fan
  geometry. Card-flip animation itself stayed: incoming `deck_fx` and server-side facing
  changes use it, and future rules will need "a card lying face up on the table".
- **Free mode** (`GameState.freeMode`, off until the dealer presses «ГОУ!») — the first
  brick of the future rules system (rules will later be configs). It flips the room into
  `phase: "playing"` WITHOUT dealing the deck out: the deck stays in the centre face
  down, and every player pulls a card for themselves — `take_card` takes the top one by
  default but accepts a POSITION, because the deck can be fanned out locally and any card
  in the fan is grabbable; `take_all` empties the deck into one hand. The bottom bar shows
  these as the shouts «соснуть»/«сосать» rather than as buttons labelled "take" (they're
  the only labels that fit a 375px phone without being cut — the underlying
  label-shortening still measures characters while the button is measured in pixels, so a
  long label will get clipped again).
  Nobody may put a card into someone else's hand — the dealer included:
  `deal_card` answers `action_rejected` with `free_mode`. Two simultaneous pulls need no
  extra logic — Colyseus processes messages one at a time, so the first taker gets the
  top card and the second gets the next one. The only way out is `collect_hands`
  («Перераздача»), which returns the room to `lobby` and to dealing. Note the side
  effect of the phase change: the `phase === "lobby"` deck handlers (shuffling,
  `reset_deck`) go away on their own — that is the intent.
- **Dealer vote weight** is 1.01 (`DEALER_VOTE_WEIGHT` in `handRules.ts`), not 1.5: the
  dealer only decides tied votes, two regular players always outweigh them. The client
  must show the SAME weight (`client/src/game/voteWeight.ts`) — it used to display 1.5,
  so the banner's progress bar disagreed with the actual outcome.
- **Ready state gates dealing** — the server won't accept `deal_card` for a player with
  `isReady === false` (except the dealer, who is always ready). This is intentional,
  even though it diverges from the very first task description ("don't care if they're
  ready or not") — a decision made consciously during the work.
- The dealer has special powers: shuffling/flipping/fanning the table deck, resetting
  the whole deck and collecting everyone's cards back (`collect_hands`, `reset_deck`),
  round-robin auto-dealing (dealer receives last).

## Known trade-offs (deliberate, not forgotten)

- `RoomEngine.ts` is still ~3400 lines, but no longer a wall: ~187 methods averaging 18
  lines, the longest being `dropCard` (76) and `onPointerUp` (74). What keeps it big is
  ~120 private fields shared across gestures and animations — cutting it further means
  moving state out of the class (separate gesture and animation owners), which is a
  bigger change than anything done so far and needs a real reason to start.
- Server message handlers are split by theme (`server/src/messages/*`) and get what they
  need from the room through the `RoomHost` interface; every write to the schema goes
  through `stateWrite.ts` (that's where the `clear()+push()` rule is enforced once).
- There are no game rules (tricks, trumps, win conditions, etc.) in the code — only the
  mechanics of owning and moving cards, on which rules can be layered later.
