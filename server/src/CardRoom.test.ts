import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { boot, ColyseusTestServer } from "@colyseus/testing";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { CardRoom } from "./CardRoom.js";
import { TestRoom } from "./TestRoom.js";
import { BOT_COUNT } from "./bots.js";
import { getLastRoom } from "./lastRooms.js";

// Любой непустой accountId в тестах считаем валидным аккаунтом, чтобы onAuth вернул
// uid = accountId (в реале это findAccountById из accounts.json). Без мока onAuth
// свалился бы в guest-<sessionId> и не дал бы стабильной идентичности между входами.
vi.mock("./accounts.js", () => ({
  findAccountById: (id: string) => (id ? { id, name: "T", recoveryHash: "X", createdAt: 0 } : null),
}));

// Короткие таймауты — тесты не ждут реальные секунды. CardRoom читает их «лениво»
// (при каждом обращении) из process.env, ровно ради тестируемости.
process.env.VOTE_TIMEOUT_MS = "150";
process.env.EMPTY_ROOM_TTL_MS = "300"; // сколько живёт опустевшая (все на паузе) комната
process.env.SHUFFLE_LOCK_MS = "300"; // сторож сессии тасовки, если клиент отвалился

function createGameServer() {
  const server = new Server({ transport: new WebSocketTransport() });
  server.define("card_room", CardRoom);
  server.define("test_room", TestRoom);
  return server;
}

describe("CardRoom", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    colyseus = await boot(createGameServer());
  });

  afterAll(async () => {
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  it("makes the first player to join the dealer", async () => {
    const room = await colyseus.createRoom("card_room", { name: "Alice", deckType: "36" });
    const client = await colyseus.connectTo(room, { name: "Alice" });

    const player = room.state.players.get(client.sessionId);
    expect(player?.isDealer).toBe(true);
    expect(player?.name).toBe("Alice");
  });

  it("does not make the second player the dealer", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    await colyseus.connectTo(room, { name: "Alice" });
    const second = await colyseus.connectTo(room, { name: "Bob" });

    expect(room.state.players.get(second.sessionId)?.isDealer).toBe(false);
  });

  it("toggles isReady on 'ready'", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const client = await colyseus.connectTo(room, { name: "Alice" });

    const waiter = room.waitForMessage("ready");
    client.send("ready");
    await waiter;

    expect(room.state.players.get(client.sessionId)?.isReady).toBe(true);
  });

  it("builds a full 36-card deck for deckType '36'", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    expect(room.state.deck.length).toBe(36);
  });

  it("builds a full 52-card deck for deckType '52'", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "52" });
    expect(room.state.deck.length).toBe(52);
  });

  it("start_game deals the full deck evenly and moves phase to 'playing'", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice" });
    const second = await colyseus.connectTo(room, { name: "Bob" });

    const waiter = room.waitForMessage("start_game");
    dealer.send("start_game");
    await waiter;

    expect(room.state.phase).toBe("playing");
    expect(room.state.deck.length).toBe(0);
    const dealerHand = room.state.players.get(dealer.sessionId)!.hand.length;
    const secondHand = room.state.players.get(second.sessionId)!.hand.length;
    expect(dealerHand + secondHand).toBe(36);
    expect(Math.abs(dealerHand - secondHand)).toBeLessThanOrEqual(1);
  });

  it("propose_dealer + majority vote transfers the dealer badge", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice" });
    const second = await colyseus.connectTo(room, { name: "Bob" });

    let waiter = room.waitForMessage("propose_dealer");
    second.send("propose_dealer");
    await waiter;

    waiter = room.waitForMessage("vote");
    dealer.send("vote", { value: true });
    await waiter;

    expect(room.state.players.get(second.sessionId)?.isDealer).toBe(true);
    expect(room.state.players.get(dealer.sessionId)?.isDealer).toBe(false);
    expect(room.state.activeProposal?.proposerId).toBeFalsy();
  });

  it("propose_kick + majority vote removes the target from the room", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice" });
    const target = await colyseus.connectTo(room, { name: "Bob" });

    const waiter = room.waitForMessage("propose_kick");
    dealer.send("propose_kick", { targetSessionId: target.sessionId });
    await waiter;

    // У дилера вес 1.5 — этого одного голоса уже достаточно для большинства
    // при total = 2.5 (дилер 1.5 + цель 1).
    expect(room.state.players.has(target.sessionId)).toBe(false);
  });

  it("excludes non-voters once the vote deadline passes, deciding on cast votes only", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const proposer = await colyseus.connectTo(room, { name: "Alice" });
    const target = await colyseus.connectTo(room, { name: "Bob" });
    // Третий игрок молчит и никогда не голосует.
    await colyseus.connectTo(room, { name: "Silent" });

    const waiter = room.waitForMessage("propose_kick");
    proposer.send("propose_kick", { targetSessionId: target.sessionId });
    await waiter;

    // Сразу после предложения большинства ещё нет (1 голос "за" из 3.5 общего веса).
    expect(room.state.activeProposal?.proposerId).toBeTruthy();

    // Ждём дольше, чем VOTE_TIMEOUT_MS (150мс), чтобы таймаут форсированно разрешил голосование.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(room.state.players.has(target.sessionId)).toBe(false);
  });

  it("deck starts in the center", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    expect(room.state.deckLocation).toBe("center");
  });

  it("move_deck 'safe' (dealer) registers the deck in the dealer's safe zone without emptying it", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice" });

    const waiter = room.waitForMessage("move_deck");
    dealer.send("move_deck", { zone: "safe" });
    await waiter;

    // Колода «уехала» в сейф-зону дилера — привязана к его sessionId, рубашкой вверх.
    expect(room.state.deckLocation).toBe(dealer.sessionId);
    // Карты не раздаются и не исчезают — просто меняют зону.
    expect(room.state.deck.length).toBe(36);
  });

  it("move_deck 'center' returns the deck to the center", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice" });

    let waiter = room.waitForMessage("move_deck");
    dealer.send("move_deck", { zone: "safe" });
    await waiter;
    expect(room.state.deckLocation).toBe(dealer.sessionId);

    waiter = room.waitForMessage("move_deck");
    dealer.send("move_deck", { zone: "center" });
    await waiter;
    expect(room.state.deckLocation).toBe("center");
  });

  // Место игрока за столом — прямоугольная дроп-зона: бросок колоды на него отдаёт
  // колоду ему (deckLocation = его id). Работает и для ботов — они такие же игроки.
  it("move_deck 'player' hands the deck to that player's seat", async () => {
    const room = await colyseus.createRoom("test_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice", accountId: "acc-seat-1" });
    const botId = [...room.state.players.entries()].find(([, p]) => p.isBot)![0];

    const waiter = room.waitForMessage("move_deck");
    dealer.send("move_deck", { zone: "player", targetId: botId });
    await waiter;

    expect(room.state.deckLocation).toBe(botId);
    expect(room.state.deck.length).toBe(36); // колода просто сменила место
  });

  it("ignores move_deck 'player' for an unknown target and from a non-dealer", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice" });
    const other = await colyseus.connectTo(room, { name: "Bob" });

    let waiter = room.waitForMessage("move_deck");
    dealer.send("move_deck", { zone: "player", targetId: "no-such-player" });
    await waiter;
    expect(room.state.deckLocation).toBe("center");

    waiter = room.waitForMessage("move_deck");
    other.send("move_deck", { zone: "player", targetId: dealer.sessionId });
    await waiter;
    expect(room.state.deckLocation).toBe("center");
  });

  it("ignores move_deck from a non-dealer", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    await colyseus.connectTo(room, { name: "Alice" });
    const second = await colyseus.connectTo(room, { name: "Bob" });

    const waiter = room.waitForMessage("move_deck");
    second.send("move_deck", { zone: "safe" });
    await waiter;

    expect(room.state.deckLocation).toBe("center");
  });

  it("ignores move_deck once the game has started (not in lobby)", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice" });
    await colyseus.connectTo(room, { name: "Bob" });

    let waiter = room.waitForMessage("start_game");
    dealer.send("start_game");
    await waiter;
    expect(room.state.phase).toBe("playing");

    waiter = room.waitForMessage("move_deck");
    dealer.send("move_deck", { zone: "safe" });
    await waiter;

    expect(room.state.deckLocation).toBe("center");
  });

  it("toggle_public can be sent by any player, not only the dealer", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    await colyseus.connectTo(room, { name: "Alice" });
    const second = await colyseus.connectTo(room, { name: "Bob" });

    expect(room.state.isPublic).toBe(false);
    const waiter = room.waitForMessage("toggle_public");
    second.send("toggle_public");
    await waiter;

    expect(room.state.isPublic).toBe(true);
  });

  // --- память комнаты: последняя комната аккаунта + восстановление руки ---

  it("records the account's last visited room on join", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    await colyseus.connectTo(room, { name: "Alice", accountId: "acc-last-1" });

    expect(getLastRoom("acc-last-1")?.roomId).toBe(room.roomId);
    expect(getLastRoom("acc-last-1")?.deckType).toBe("36");
  });

  it("restores the hand when the same account rejoins after a disconnect", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const a = await colyseus.connectTo(room, { name: "Alice", accountId: "acc-rejoin" });
    await colyseus.connectTo(room, { name: "Bob", accountId: "acc-bob" }); // держит комнату живой

    const waiter = room.waitForMessage("start_game");
    a.send("start_game");
    await waiter;
    const handBefore = [...room.state.players.get(a.sessionId)!.hand];
    expect(handBefore.length).toBeGreaterThan(0);

    // A отваливается; ждём финализации (снапшот) дольше окна переподключения.
    await a.leave();
    await new Promise((r) => setTimeout(r, 400));

    // A заходит снова тем же аккаунтом → рука должна восстановиться.
    const a2 = await colyseus.connectTo(room, { name: "Alice", accountId: "acc-rejoin" });
    const restored = [...room.state.players.get(a2.sessionId)!.hand];
    expect(restored).toEqual(handBefore);
  });

  it("keeps a disconnected player in the room, just paused (not removed)", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const a = await colyseus.connectTo(room, { name: "Alice", accountId: "acc-pause-a" });
    await colyseus.connectTo(room, { name: "Bob", accountId: "acc-pause-b" }); // держит комнату

    await a.leave();
    await new Promise((r) => setTimeout(r, 100));

    const paused = [...room.state.players.values()].find((p) => p.id === "acc-pause-a");
    expect(paused).toBeDefined(); // остался в комнате
    expect(paused!.connected).toBe(false); // на паузе
  });

  it("a disconnected dealer keeps the dealer badge (no auto-transfer)", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const a = await colyseus.connectTo(room, { name: "Alice", accountId: "acc-deal-a" }); // дилер
    const b = await colyseus.connectTo(room, { name: "Bob", accountId: "acc-deal-b" });

    await a.leave();
    await new Promise((r) => setTimeout(r, 100));

    expect(room.state.players.get(b.sessionId)?.isDealer).toBe(false); // не передали
    const pausedA = [...room.state.players.values()].find((p) => p.id === "acc-deal-a");
    expect(pausedA?.isDealer).toBe(true); // остался дилером
  });

  it("re-activates the player and keeps dealer on return", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const a = await colyseus.connectTo(room, { name: "Alice", accountId: "acc-ret-a" }); // дилер
    await colyseus.connectTo(room, { name: "Bob", accountId: "acc-ret-b" });

    await a.leave();
    await new Promise((r) => setTimeout(r, 100));

    const a2 = await colyseus.connectTo(room, { name: "Alice", accountId: "acc-ret-a" });
    const back = room.state.players.get(a2.sessionId);
    expect(back?.connected).toBe(true); // снова активен
    expect(back?.isDealer).toBe(true); // всё ещё дилер
    // один игрок на аккаунт — старый sessionId убран
    expect([...room.state.players.values()].filter((p) => p.id === "acc-ret-a").length).toBe(1);
  });

  // Перезагрузка страницы (и StrictMode в дев-режиме) умеет открыть второе соединение
  // ДО того, как отвалилось первое. Перехват «один игрок на аккаунт» отдаёт запись
  // новому sessionId — старое соединение обязано закрыться, иначе оно висит живым, но
  // БЕЗ игрока в state: клиент видит себя не-дилером и вообще не в списке.
  it("closes the displaced connection when the same account joins twice", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const first = await colyseus.connectTo(room, { name: "Alice", accountId: "acc-dup" });
    expect(room.state.players.get(first.sessionId)?.isDealer).toBe(true);

    const second = await colyseus.connectTo(room, { name: "Alice", accountId: "acc-dup" });
    await new Promise((r) => setTimeout(r, 100));

    // Живой игрок — только новый, и он унаследовал дилерство.
    expect(room.state.players.get(second.sessionId)?.isDealer).toBe(true);
    expect([...room.state.players.values()].filter((p) => p.id === "acc-dup").length).toBe(1);
    // Осиротевшее соединение закрыто, а не брошено висеть.
    expect(room.clients.some((c) => c.sessionId === first.sessionId)).toBe(false);
  });

  it("keeps an emptied room alive until TTL, then disposes and forgets it", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const a = await colyseus.connectTo(room, { name: "Alice", accountId: "acc-empty" });
    expect(getLastRoom("acc-empty")?.roomId).toBe(room.roomId);

    await a.leave();
    // Дольше EMPTY_ROOM_TTL_MS (300) — комната диспоузится, память забывается.
    await new Promise((r) => setTimeout(r, 600));

    expect(getLastRoom("acc-empty")).toBeUndefined();
  });

  // Тестовая комната: те же правила, но за столом сразу сидят боты — чтобы можно было
  // делать посадку/вёрстку/дроп-зоны, не собирая живых людей. Базовый минимум: они
  // просто есть и готовы.
  describe("TestRoom (комната с ботами)", () => {
    it("создаётся сразу с ботами: они в комнате, подключены и готовы", async () => {
      const room = await colyseus.createRoom("test_room", { deckType: "36" });

      const bots = [...room.state.players.values()].filter((p) => p.isBot);
      expect(bots.length).toBe(BOT_COUNT);
      expect(bots.every((b) => b.connected)).toBe(true);
      expect(bots.every((b) => b.isReady)).toBe(true);
    });

    it("выдаёт код приглашения — в неё можно вернуться после перезагрузки", async () => {
      const room = await colyseus.createRoom("test_room", { deckType: "36" });
      expect(room.state.inviteCode).toMatch(/^\d{6}$/);
    });

    it("дилером становится первый ЖИВОЙ игрок, а не бот", async () => {
      const room = await colyseus.createRoom("test_room", { deckType: "36" });
      const human = await colyseus.connectTo(room, { name: "Alice", accountId: "acc-bots-1" });

      expect(room.state.players.get(human.sessionId)?.isDealer).toBe(true);
      expect([...room.state.players.values()].filter((p) => p.isDealer).length).toBe(1);
    });

    it("боты не держат опустевшую комнату — TTL всё равно срабатывает", async () => {
      const room = await colyseus.createRoom("test_room", { deckType: "36" });
      const a = await colyseus.connectTo(room, { name: "Alice", accountId: "acc-bots-2" });
      expect(getLastRoom("acc-bots-2")?.roomId).toBe(room.roomId);

      await a.leave();
      await new Promise((r) => setTimeout(r, 600)); // дольше EMPTY_ROOM_TTL_MS

      expect(getLastRoom("acc-bots-2")).toBeUndefined();
    });

    it("раздача доходит и до ботов — рука есть у всех за столом", async () => {
      const room = await colyseus.createRoom("test_room", { deckType: "36" });
      const dealer = await colyseus.connectTo(room, { name: "Alice", accountId: "acc-bots-3" });

      const waiter = room.waitForMessage("start_game");
      dealer.send("start_game");
      await waiter;

      const hands = [...room.state.players.values()].map((p) => p.hand.length);
      expect(hands.length).toBe(BOT_COUNT + 1);
      expect(hands.every((n) => n > 0)).toBe(true);
      expect(hands.reduce((a, b) => a + b, 0)).toBe(36);
    });

    it("обычная комната ботов не заводит", async () => {
      const room = await colyseus.createRoom("card_room", { deckType: "36" });
      expect([...room.state.players.values()].filter((p) => p.isBot).length).toBe(0);
    });
  });

  // Драг отдельной карты в раскрытом веере: дилер меняет её место в колоде, порядок
  // сохраняется на сервере (эхом расходится всем).
  it("reorder_deck moves one card to a new position, keeping the same cards", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice" });
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
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    await colyseus.connectTo(room, { name: "Alice" });
    const second = await colyseus.connectTo(room, { name: "Bob" });
    const before = [...room.state.deck];

    let waiter = room.waitForMessage("reorder_deck");
    second.send("reorder_deck", { card: before[0], to: 7 });
    await waiter;
    expect([...room.state.deck]).toEqual(before);

    const dealerClient = await colyseus.connectTo(room, { name: "Carol" });
    waiter = room.waitForMessage("reorder_deck");
    dealerClient.send("reorder_deck", { card: "нет такой", to: 3 });
    await waiter;
    expect([...room.state.deck]).toEqual(before);
  });

  it("ignores reorder_deck after the game started (only in lobby)", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice" });
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
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice" });
    const before = [...room.state.deck];
    const next = [before[7], ...before.filter((_, i) => i !== 7)];

    const waiter = room.waitForMessage("set_deck_order");
    dealer.send("set_deck_order", { order: next });
    await waiter;

    expect([...room.state.deck]).toEqual(next);
  });

  it("rejects a tampered order and a non-dealer", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice" });
    const second = await colyseus.connectTo(room, { name: "Bob" });
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
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice" });

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
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice" });

    const waiter = room.waitForMessage("shuffle_start");
    dealer.send("shuffle_start");
    await waiter;
    expect(room.state.shufflingBy).toBe(dealer.sessionId);

    await new Promise((r) => setTimeout(r, 500)); // дольше SHUFFLE_LOCK_MS
    expect(room.state.shufflingBy).toBe("");
  });

  it("releases the lock when the shuffling player leaves", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice" });
    await colyseus.connectTo(room, { name: "Bob" });

    const waiter = room.waitForMessage("shuffle_start");
    dealer.send("shuffle_start");
    await waiter;

    await dealer.leave();
    expect(room.state.shufflingBy).toBe("");
  });

  // ——— сторона карт ———

  it("fresh deck lies face down; flip_deck reverses order and flips every card", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice" });
    const before = [...room.state.deck];
    expect([...room.state.faceUp.values()].every((v) => v === false)).toBe(true);

    const waiter = room.waitForMessage("flip_deck");
    dealer.send("flip_deck");
    await waiter;

    expect([...room.state.deck]).toEqual([...before].reverse());
    expect([...room.state.faceUp.values()].every((v) => v === true)).toBe(true);
  });

  it("flip_cards flips only the given cards and keeps the order", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice" });
    const before = [...room.state.deck];
    const target = before[4];

    const waiter = room.waitForMessage("flip_cards");
    dealer.send("flip_cards", { cards: [target] });
    await waiter;

    expect([...room.state.deck]).toEqual(before); // порядок не тронут
    expect(room.state.faceUp.get(target)).toBe(true);
    expect(room.state.faceUp.get(before[5])).toBe(false); // соседей не задело
  });

  it("ignores flips from a non-dealer", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    await colyseus.connectTo(room, { name: "Alice" });
    const second = await colyseus.connectTo(room, { name: "Bob" });
    const before = [...room.state.deck];

    let waiter = room.waitForMessage("flip_deck");
    second.send("flip_deck");
    await waiter;
    expect([...room.state.deck]).toEqual(before);

    waiter = room.waitForMessage("flip_cards");
    second.send("flip_cards", { cards: [before[0]] });
    await waiter;
    expect(room.state.faceUp.get(before[0])).toBe(false);
  });

  it("card facing follows the card through a reorder", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice" });
    const card = room.state.deck[0];

    let waiter = room.waitForMessage("flip_cards");
    dealer.send("flip_cards", { cards: [card] });
    await waiter;

    waiter = room.waitForMessage("reorder_deck");
    dealer.send("reorder_deck", { card, to: 20 });
    await waiter;

    expect(room.state.deck[20]).toBe(card);
    expect(room.state.faceUp.get(card)).toBe(true); // сторона уехала вместе с картой
  });

  // Клиент показывает переворот СРАЗУ, поэтому отказ обязан быть явным: иначе он
  // останется с картинкой, которой на сервере не существует.
  it("answers a rejected flip with a reason instead of staying silent", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    await colyseus.connectTo(room, { name: "Alice" });
    const second = await colyseus.connectTo(room, { name: "Bob" });
    const card = room.state.deck[0];

    const rejects: any[] = [];
    second.onMessage("action_rejected", (m) => rejects.push(m));

    let waiter = room.waitForMessage("flip_deck");
    second.send("flip_deck");
    await waiter;

    waiter = room.waitForMessage("flip_cards");
    second.send("flip_cards", { cards: [card] });
    await waiter;
    await new Promise((r) => setTimeout(r, 50));

    expect(rejects.map((r) => r.action)).toEqual(["flip_deck", "flip_cards"]);
    expect(rejects.every((r) => r.reason === "not_dealer")).toBe(true);
    expect(rejects[1].cards).toEqual([card]); // клиенту вернут ровно те карты, что он крутил
    expect(room.state.faceUp.get(card)).toBe(false); // и состояние не тронуто
  });

  it("rejects flipping cards that are not in the deck", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice" });
    const rejects: any[] = [];
    dealer.onMessage("action_rejected", (m) => rejects.push(m));

    const waiter = room.waitForMessage("flip_cards");
    dealer.send("flip_cards", { cards: ["джокер"] });
    await waiter;
    await new Promise((r) => setTimeout(r, 50));

    expect(rejects[0]?.reason).toBe("unknown_cards");
  });
});
