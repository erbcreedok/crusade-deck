import { describe, it, expect, vi } from "vitest";
import { leaveDealMode, TEST_PORTS, useTestServer } from "./roomHarness.js";

// Любой непустой accountId в тестах считаем валидным аккаунтом, чтобы onAuth вернул
// uid = accountId (в реале это findAccountById из accounts.json). Без мока onAuth
// свалился бы в guest-<sessionId> и не дал бы стабильной идентичности между входами.
vi.mock("./accounts.js", () => ({
  findAccountById: (id: string) => (id ? { id, name: "T", recoveryHash: "X", createdAt: 0 } : null),
}));

// Где лежит колода, её порядок и сессия тасовки: перенос по зонам, реордер, готовый
// порядок от клиента, «замок» тасующего, веер на столе и сброс колоды.
describe("CardRoom: колода", () => {
  const server = useTestServer(TEST_PORTS.deck);

  it("deck starts in the center", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    expect(room.state.deckLocation).toBe("center");
  });

  it("move_deck 'hand' — колода уходит в мою руку (там она и раскрывается веером)", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });

    // Переносить колоду можно только ВНЕ режима раздачи — там она живёт в центре.
    let waiter = room.waitForMessage("toggle_deal_mode");
    dealer.send("toggle_deal_mode");
    await waiter;

    waiter = room.waitForMessage("move_deck");
    dealer.send("move_deck", { zone: "hand" });
    await waiter;

    expect(room.state.deckLocation).toBe(dealer.sessionId);
    expect(room.state.deck.length).toBe(36); // карты не раздаются, только меняют место
  });

  it("move_deck 'center' возвращает колоду на стол и забывает слот", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    await (async () => {
      const w = room.waitForMessage("toggle_deal_mode");
      dealer.send("toggle_deal_mode");
      await w;
    })();

    let waiter = room.waitForMessage("move_deck");
    dealer.send("move_deck", { zone: "hand" });
    await waiter;

    waiter = room.waitForMessage("move_deck");
    dealer.send("move_deck", { zone: "center" });
    await waiter;

    expect(room.state.deckLocation).toBe("center");
  });

  it("ignores move_deck from a non-dealer", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });

    const waiter = room.waitForMessage("move_deck");
    second.send("move_deck", { zone: "hand" });
    await waiter;

    expect(room.state.deckLocation).toBe("center");
  });

  it("ignores move_deck once the game has started (not in lobby)", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    await server().connectTo(room, { name: "Bob" });

    let waiter = room.waitForMessage("start_game");
    dealer.send("start_game");
    await waiter;
    expect(room.state.phase).toBe("playing");

    waiter = room.waitForMessage("move_deck");
    dealer.send("move_deck", { zone: "hand" });
    await waiter;

    expect(room.state.deckLocation).toBe("center");
  });

  // Драг отдельной карты в раскрытом веере: дилер меняет её место в колоде, порядок
  // сохраняется на сервере (эхом расходится всем).
  it("reorder_deck moves one card to a new position, keeping the same cards", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const before = [...room.state.deck];
    const card = before[0];

    const waiter = room.waitForMessage("reorder_deck");
    dealer.send("reorder_deck", { card, to: 5 });
    await waiter;

    const after = [...room.state.deck];
    expect([...after].sort()).toEqual([...before].sort()); // тот же набор
    expect(after.indexOf(card)).toBe(5);
    expect(after.filter((c) => c === card).length).toBe(1); // не задвоилась
  });

  it("ignores reorder_deck from a non-dealer and for an unknown card", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });
    const before = [...room.state.deck];

    let waiter = room.waitForMessage("reorder_deck");
    second.send("reorder_deck", { card: before[0], to: 7 });
    await waiter;
    expect([...room.state.deck]).toEqual(before);

    const dealerClient = await server().connectTo(room, { name: "Carol" });
    waiter = room.waitForMessage("reorder_deck");
    dealerClient.send("reorder_deck", { card: "нет такой", to: 3 });
    await waiter;
    expect([...room.state.deck]).toEqual(before);
  });

  it("ignores reorder_deck after the game started (only in lobby)", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const card = room.state.deck[0];

    let waiter = room.waitForMessage("start_game");
    dealer.send("start_game");
    await waiter;

    waiter = room.waitForMessage("reorder_deck");
    dealer.send("reorder_deck", { card, to: 4 });
    await waiter;

    expect(room.state.phase).toBe("playing");
    expect(room.state.deck.length).toBe(0); // колода роздана — двигать нечего
  });

  // Свайп по вееру тасует НА КЛИЕНТЕ и присылает готовый порядок — сервер его принимает,
  // но только если это перестановка текущей колоды.
  it("set_deck_order accepts a client-computed permutation", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const before = [...room.state.deck];
    const next = [before[7], ...before.filter((_, i) => i !== 7)];

    const waiter = room.waitForMessage("set_deck_order");
    dealer.send("set_deck_order", { order: next });
    await waiter;

    expect([...room.state.deck]).toEqual(next);
  });

  it("rejects a tampered order and a non-dealer", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });
    const before = [...room.state.deck];

    // подменённая карта
    let waiter = room.waitForMessage("set_deck_order");
    dealer.send("set_deck_order", { order: ["джокер", ...before.slice(1)] });
    await waiter;
    expect([...room.state.deck]).toEqual(before);

    // укороченная колода
    waiter = room.waitForMessage("set_deck_order");
    dealer.send("set_deck_order", { order: before.slice(0, 10) });
    await waiter;
    expect([...room.state.deck]).toEqual(before);

    // не дилер
    waiter = room.waitForMessage("set_deck_order");
    second.send("set_deck_order", { order: [...before].reverse() });
    await waiter;
    expect([...room.state.deck]).toEqual(before);
  });

  // Сессия тасовки: порядок считает клиент, сервер держит «замок» и валидирует результат.
  it("shuffle_start marks who is shuffling, final set_deck_order releases the lock", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });

    let waiter = room.waitForMessage("shuffle_start");
    dealer.send("shuffle_start");
    await waiter;
    expect(room.state.shufflingBy).toBe(dealer.sessionId);

    const next = [...room.state.deck].reverse();
    waiter = room.waitForMessage("set_deck_order");
    dealer.send("set_deck_order", { order: next, final: true });
    await waiter;

    expect([...room.state.deck]).toEqual(next);
    expect(room.state.shufflingBy).toBe(""); // сессия закрыта
  });

  it("releases a stuck shuffle lock by timeout (client vanished mid-gesture)", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });

    const waiter = room.waitForMessage("shuffle_start");
    dealer.send("shuffle_start");
    await waiter;
    expect(room.state.shufflingBy).toBe(dealer.sessionId);

    await new Promise((r) => setTimeout(r, 500)); // дольше SHUFFLE_LOCK_MS
    expect(room.state.shufflingBy).toBe("");
  });

  it("releases the lock when the shuffling player leaves", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    await server().connectTo(room, { name: "Bob" });

    const waiter = room.waitForMessage("shuffle_start");
    dealer.send("shuffle_start");
    await waiter;

    await dealer.leave();
    expect(room.state.shufflingBy).toBe("");
  });

  it("move_deck в режиме раздачи не двигает колоду; после выхода из режима — двигает", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });

    let waiter = room.waitForMessage("move_deck");
    dealer.send("move_deck", { zone: "hand" });
    await waiter;
    expect(room.state.deckLocation).toBe("center"); // dealMode включён по умолчанию

    waiter = room.waitForMessage("toggle_deal_mode");
    dealer.send("toggle_deal_mode");
    await waiter;

    waiter = room.waitForMessage("move_deck");
    dealer.send("move_deck", { zone: "hand" });
    await waiter;
    expect(room.state.deckLocation).toBe(dealer.sessionId);
  });

  it("set_deck_fanned: дилер раскрывает веер на столе, все это видят", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });

    let waiter = room.waitForMessage("set_deck_fanned");
    second.send("set_deck_fanned", { open: true }); // не дилер
    await waiter;
    expect(room.state.deckFanned).toBe(false);

    waiter = room.waitForMessage("set_deck_fanned");
    dealer.send("set_deck_fanned", { open: true });
    await waiter;
    expect(room.state.deckFanned).toBe(true);

    waiter = room.waitForMessage("set_deck_fanned");
    dealer.send("set_deck_fanned", { open: false });
    await waiter;
    expect(room.state.deckFanned).toBe(false);
  });

  it("set_deck_order много раз подряд не раздувает колоду", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    expect(room.state.deck.length).toBe(36);

    for (let i = 0; i < 12; i++) {
      const cur = room.state.deck.toArray();
      const next = [cur[cur.length - 1]!, ...cur.slice(0, -1)];
      const waiter = room.waitForMessage("set_deck_order");
      dealer.send("set_deck_order", { order: next, rev: i + 1 });
      await waiter;
      expect(room.state.deck.length).toBe(36);
    }
  });

  it("reset_deck: дилер получает новую неперемешанную колоду, руки пусты", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });
    const card = room.state.deck[room.state.deck.length - 1]!;
    let waiter = room.waitForMessage("ready");
    second.send("ready");
    await waiter;
    const wDeal = room.waitForMessage("deal_card");
    dealer.send("deal_card", { card, to: second.sessionId });
    await wDeal;
    expect(room.state.players.get(second.sessionId)!.hand.length).toBe(1);

    // Перемешаем порядок, чтобы fresh deck отличался от текущего.
    const shuffled = [...room.state.deck.toArray()].reverse();
    const wOrd = room.waitForMessage("set_deck_order");
    dealer.send("set_deck_order", { order: shuffled, rev: 1 });
    await wOrd;

    const before = room.state.deck.toArray();
    const resetFx = new Promise<{ order: string[]; counts: Record<string, number> }>((resolve) => {
      second.onMessage("deck_reset", (m) => resolve(m));
    });
    waiter = room.waitForMessage("reset_deck");
    dealer.send("reset_deck");
    await waiter;
    const fx = await resetFx;

    expect(room.state.deck.length).toBe(36);
    expect(room.state.players.get(second.sessionId)!.hand.length).toBe(0);
    expect(room.state.deckFanned).toBe(false);
    expect(room.state.deckLocation).toBe("center");
    // Новая колода — канонический порядок buildDeck, не бывший после реверса.
    expect(room.state.deck.toArray()).not.toEqual(before);
    expect(room.state.deck[0]).toBe("6♠");
    expect(room.state.deck[35]).toBe("A♣");
    expect(fx.order[0]).toBe(dealer.sessionId);
    expect(fx.counts[second.sessionId]).toBe(1);
  });

  it("reset_deck отбивает не-дилера", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });
    const before = room.state.deck.toArray();

    const waiter = room.waitForMessage("reset_deck");
    second.send("reset_deck");
    await waiter;
    expect(room.state.deck.toArray()).toEqual(before);
  });
});
