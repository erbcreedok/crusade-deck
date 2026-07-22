import { describe, it, expect, vi } from "vitest";
import { leaveDealMode, TEST_PORTS, useTestServer } from "./roomHarness.js";
import { getLastRoom } from "./lastRooms.js";

// Любой непустой accountId в тестах считаем валидным аккаунтом, чтобы onAuth вернул
// uid = accountId (в реале это findAccountById из accounts.json). Без мока onAuth
// свалился бы в guest-<sessionId> и не дал бы стабильной идентичности между входами.
vi.mock("./accounts.js", () => ({
  findAccountById: (id: string) => (id ? { id, name: "T", recoveryHash: "X", createdAt: 0 } : null),
}));

// Кто становится дилером, готовность, состав колоды, старт игры, а также жизнь
// комнаты: возврат того же аккаунта, пауза при обрыве, перехват соединения, TTL.
describe("CardRoom: вход, роли и жизнь комнаты", () => {
  const server = useTestServer(TEST_PORTS.lifecycle);

  it("makes the first player to join the dealer", async () => {
    const room = await server().createRoom("card_room", { name: "Alice", deckType: "36" });
    const client = await server().connectTo(room, { name: "Alice" });

    const player = room.state.players.get(client.sessionId);
    expect(player?.isDealer).toBe(true);
    expect(player?.name).toBe("Alice");
  });

  it("does not make the second player the dealer", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });

    expect(room.state.players.get(second.sessionId)?.isDealer).toBe(false);
  });

  it("toggles isReady on 'ready'", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const client = await server().connectTo(room, { name: "Bob" });

    // Дилер всегда готов и не сбрасывается.
    expect(room.state.players.get(dealer.sessionId)?.isReady).toBe(true);
    let waiter = room.waitForMessage("ready");
    dealer.send("ready");
    await waiter;
    expect(room.state.players.get(dealer.sessionId)?.isReady).toBe(true);

    waiter = room.waitForMessage("ready");
    client.send("ready");
    await waiter;

    expect(room.state.players.get(client.sessionId)?.isReady).toBe(true);
  });

  it("builds a full 36-card deck for deckType '36'", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    expect(room.state.deck.length).toBe(36);
  });

  it("builds a full 52-card deck for deckType '52'", async () => {
    const room = await server().createRoom("card_room", { deckType: "52" });
    expect(room.state.deck.length).toBe(52);
  });

  it("start_game deals the full deck evenly and moves phase to 'playing'", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });

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

  it("toggle_public can be sent by any player, not only the dealer", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });

    expect(room.state.isPublic).toBe(false);
    const waiter = room.waitForMessage("toggle_public");
    second.send("toggle_public");
    await waiter;

    expect(room.state.isPublic).toBe(true);
  });

  it("records the account's last visited room on join", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    await server().connectTo(room, { name: "Alice", accountId: "acc-last-1" });

    expect(getLastRoom("acc-last-1")?.roomId).toBe(room.roomId);
    expect(getLastRoom("acc-last-1")?.deckType).toBe("36");
  });

  it("restores the hand when the same account rejoins after a disconnect", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const a = await server().connectTo(room, { name: "Alice", accountId: "acc-rejoin" });
    await server().connectTo(room, { name: "Bob", accountId: "acc-bob" }); // держит комнату живой

    const waiter = room.waitForMessage("start_game");
    a.send("start_game");
    await waiter;
    const handBefore = [...room.state.players.get(a.sessionId)!.hand];
    expect(handBefore.length).toBeGreaterThan(0);

    // A отваливается; ждём финализации (снапшот) дольше окна переподключения.
    await a.leave();
    await new Promise((r) => setTimeout(r, 400));

    // A заходит снова тем же аккаунтом → рука должна восстановиться.
    const a2 = await server().connectTo(room, { name: "Alice", accountId: "acc-rejoin" });
    const restored = [...room.state.players.get(a2.sessionId)!.hand];
    expect(restored).toEqual(handBefore);
  });

  it("keeps a disconnected player in the room, just paused (not removed)", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const a = await server().connectTo(room, { name: "Alice", accountId: "acc-pause-a" });
    await server().connectTo(room, { name: "Bob", accountId: "acc-pause-b" }); // держит комнату

    await a.leave();
    await new Promise((r) => setTimeout(r, 100));

    const paused = [...room.state.players.values()].find((p) => p.id === "acc-pause-a");
    expect(paused).toBeDefined(); // остался в комнате
    expect(paused!.connected).toBe(false); // на паузе
  });

  it("a disconnected dealer keeps the dealer badge (no auto-transfer)", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const a = await server().connectTo(room, { name: "Alice", accountId: "acc-deal-a" }); // дилер
    const b = await server().connectTo(room, { name: "Bob", accountId: "acc-deal-b" });

    await a.leave();
    await new Promise((r) => setTimeout(r, 100));

    expect(room.state.players.get(b.sessionId)?.isDealer).toBe(false); // не передали
    const pausedA = [...room.state.players.values()].find((p) => p.id === "acc-deal-a");
    expect(pausedA?.isDealer).toBe(true); // остался дилером
  });

  it("re-activates the player and keeps dealer on return", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const a = await server().connectTo(room, { name: "Alice", accountId: "acc-ret-a" }); // дилер
    await server().connectTo(room, { name: "Bob", accountId: "acc-ret-b" });

    await a.leave();
    await new Promise((r) => setTimeout(r, 100));

    const a2 = await server().connectTo(room, { name: "Alice", accountId: "acc-ret-a" });
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
    const room = await server().createRoom("card_room", { deckType: "36" });
    const first = await server().connectTo(room, { name: "Alice", accountId: "acc-dup" });
    expect(room.state.players.get(first.sessionId)?.isDealer).toBe(true);

    const second = await server().connectTo(room, { name: "Alice", accountId: "acc-dup" });
    await new Promise((r) => setTimeout(r, 100));

    // Живой игрок — только новый, и он унаследовал дилерство.
    expect(room.state.players.get(second.sessionId)?.isDealer).toBe(true);
    expect([...room.state.players.values()].filter((p) => p.id === "acc-dup").length).toBe(1);
    // Осиротевшее соединение закрыто, а не брошено висеть.
    expect(room.clients.some((c) => c.sessionId === first.sessionId)).toBe(false);
  });

  it("keeps an emptied room alive until TTL, then disposes and forgets it", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const a = await server().connectTo(room, { name: "Alice", accountId: "acc-empty" });
    expect(getLastRoom("acc-empty")?.roomId).toBe(room.roomId);

    await a.leave();
    // Дольше EMPTY_ROOM_TTL_MS (300) — комната диспоузится, память забывается.
    await new Promise((r) => setTimeout(r, 600));

    expect(getLastRoom("acc-empty")).toBeUndefined();
  });
});
