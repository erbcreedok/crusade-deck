import { describe, it, expect, vi } from "vitest";
import { TEST_PORTS, useTestServer } from "./roomHarness.js";

// Любой непустой accountId в тестах считаем валидным аккаунтом, чтобы onAuth вернул
// uid = accountId (в реале это findAccountById из accounts.json). Без мока onAuth
// свалился бы в guest-<sessionId> и не дал бы стабильной идентичности между входами.
vi.mock("./accounts.js", () => ({
  findAccountById: (id: string) => (id ? { id, name: "T", recoveryHash: "X", createdAt: 0 } : null),
}));

// Что видно и кому. Перевороты колоды отсюда ушли вместе с «режимом раздачи»: карты в
// колоде всегда лежат рубашкой вверх, номинал узнаётся только в руке.
describe("CardRoom: что видно и кому", () => {
  const server = useTestServer(TEST_PORTS.facing);

  it("свежая колода лежит рубашкой вверх — номиналов не видит никто, включая дилера", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    await server().connectTo(room, { name: "Alice" });
    expect(room.state.deck.length).toBe(36);
    expect([...room.state.faceUp.values()].every((v) => v === false)).toBe(true);
  });

  it("toggle_card_hidden прячет и возвращает КОНКРЕТНУЮ карту, но только свою", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });

    let waiter = room.waitForMessage("start_game");
    dealer.send("start_game");
    await waiter;

    const mine = room.state.players.get(dealer.sessionId)!;
    const card = mine.hand[0];

    waiter = room.waitForMessage("toggle_card_hidden");
    dealer.send("toggle_card_hidden", { card });
    await waiter;
    expect(mine.handHidden.get(card)).toBe(true);

    waiter = room.waitForMessage("toggle_card_hidden");
    dealer.send("toggle_card_hidden", { card });
    await waiter;
    expect(mine.handHidden.get(card)).toBeUndefined(); // вернули обратно

    // Чужую карту спрятать нельзя — это карта другого игрока, не его дело.
    waiter = room.waitForMessage("toggle_card_hidden");
    second.send("toggle_card_hidden", { card });
    await waiter;
    expect(room.state.players.get(second.sessionId)!.handHidden.size).toBe(0);
  });

  it("дилерские действия не слушаются обычного игрока", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });

    const waiter = room.waitForMessage("collect_hands");
    second.send("collect_hands");
    await waiter;
    expect(room.state.deck.length).toBe(36);
  });
});
