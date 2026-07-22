import { describe, it, expect, vi } from "vitest";
import { leaveDealMode, TEST_PORTS, useTestServer } from "./roomHarness.js";
import { BOT_COUNT } from "./bots.js";
import { getLastRoom } from "./lastRooms.js";

// Любой непустой accountId в тестах считаем валидным аккаунтом, чтобы onAuth вернул
// uid = accountId (в реале это findAccountById из accounts.json). Без мока onAuth
// свалился бы в guest-<sessionId> и не дал бы стабильной идентичности между входами.
vi.mock("./accounts.js", () => ({
  findAccountById: (id: string) => (id ? { id, name: "T", recoveryHash: "X", createdAt: 0 } : null),
}));

// Тестовая комната: те же правила, но за столом сразу сидят боты — чтобы можно было
// делать посадку/вёрстку/дроп-зоны, не собирая живых людей.
describe("TestRoom (комната с ботами)", () => {
  const server = useTestServer(TEST_PORTS.bots);

  // Тестовая комната: те же правила, но за столом сразу сидят боты — чтобы можно было
  // делать посадку/вёрстку/дроп-зоны, не собирая живых людей. Базовый минимум: они
  // просто есть и готовы.
  it("создаётся сразу с ботами: они в комнате, подключены и готовы", async () => {
    const room = await server().createRoom("test_room", { deckType: "36" });

    const bots = [...room.state.players.values()].filter((p) => p.isBot);
    expect(bots.length).toBe(BOT_COUNT);
    expect(bots.every((b) => b.connected)).toBe(true);
    expect(bots.every((b) => b.isReady)).toBe(true);
  });

  it("выдаёт код приглашения — в неё можно вернуться после перезагрузки", async () => {
    const room = await server().createRoom("test_room", { deckType: "36" });
    expect(room.state.inviteCode).toMatch(/^\d{4}$/);
  });

  it("дилером становится первый ЖИВОЙ игрок, а не бот", async () => {
    const room = await server().createRoom("test_room", { deckType: "36" });
    const human = await server().connectTo(room, { name: "Alice", accountId: "acc-bots-1" });

    expect(room.state.players.get(human.sessionId)?.isDealer).toBe(true);
    expect([...room.state.players.values()].filter((p) => p.isDealer).length).toBe(1);
  });

  it("seatOrder: дилер в голове круга, боты следом, второй игрок в хвосте", async () => {
    const room = await server().createRoom("test_room", { deckType: "36" });
    const mac = await server().connectTo(room, { name: "Alice", accountId: "acc-seat-1" });
    expect([...room.state.seatOrder]).toEqual([mac.sessionId, "bot-1", "bot-2", "bot-3"]);

    const phone = await server().connectTo(room, { name: "Bob", accountId: "acc-seat-2" });
    expect([...room.state.seatOrder]).toEqual([mac.sessionId, "bot-1", "bot-2", "bot-3", phone.sessionId]);
  });

  it("боты не держат опустевшую комнату — TTL всё равно срабатывает", async () => {
    const room = await server().createRoom("test_room", { deckType: "36" });
    const a = await server().connectTo(room, { name: "Alice", accountId: "acc-bots-2" });
    expect(getLastRoom("acc-bots-2")?.roomId).toBe(room.roomId);

    await a.leave();
    await new Promise((r) => setTimeout(r, 600)); // дольше EMPTY_ROOM_TTL_MS

    expect(getLastRoom("acc-bots-2")).toBeUndefined();
  });

  it("раздача доходит и до ботов — рука есть у всех за столом", async () => {
    const room = await server().createRoom("test_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice", accountId: "acc-bots-3" });

    const waiter = room.waitForMessage("start_game");
    dealer.send("start_game");
    await waiter;

    const hands = [...room.state.players.values()].map((p) => p.hand.length);
    expect(hands.length).toBe(BOT_COUNT + 1);
    expect(hands.every((n) => n > 0)).toBe(true);
    expect(hands.reduce((a, b) => a + b, 0)).toBe(36);
  });

  it("обычная комната ботов не заводит", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    expect([...room.state.players.values()].filter((p) => p.isBot).length).toBe(0);
  });
});
