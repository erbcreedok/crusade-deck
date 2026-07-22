import { describe, it, expect, vi } from "vitest";
import { leaveDealMode, TEST_PORTS, useTestServer } from "./roomHarness.js";

// Любой непустой accountId в тестах считаем валидным аккаунтом, чтобы onAuth вернул
// uid = accountId (в реале это findAccountById из accounts.json). Без мока onAuth
// свалился бы в guest-<sessionId> и не дал бы стабильной идентичности между входами.
vi.mock("./accounts.js", () => ({
  findAccountById: (id: string) => (id ? { id, name: "T", recoveryHash: "X", createdAt: 0 } : null),
}));

// Что видно и кому: перевороты колоды и отдельных карт, отказы сервера, спрятанные
// карты и переключение режима раздачи.
describe("CardRoom: стороны карт и режим раздачи", () => {
  const server = useTestServer(TEST_PORTS.facing);

  it("fresh deck lies face down; flip_deck reverses order and flips every card", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const before = [...room.state.deck];
    expect([...room.state.faceUp.values()].every((v) => v === false)).toBe(true); // раздача прячет всё

    // Выход из раздачи сам раскрывает колоду — дальше переворот ИНВЕРТИРУЕТ сторону,
    // а не «делает лицом вверх»: это и есть физика стопки в руке.
    await leaveDealMode(room, dealer);
    expect([...room.state.faceUp.values()].every((v) => v === true)).toBe(true);

    const waiter = room.waitForMessage("flip_deck");
    dealer.send("flip_deck");
    await waiter;

    expect([...room.state.deck]).toEqual([...before].reverse());
    expect([...room.state.faceUp.values()].every((v) => v === false)).toBe(true);
  });

  it("flip_cards flips only the given cards and keeps the order", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const before = [...room.state.deck];
    const target = before[4];
    await leaveDealMode(room, dealer);

    const waiter = room.waitForMessage("flip_cards");
    dealer.send("flip_cards", { cards: [target] });
    await waiter;

    expect([...room.state.deck]).toEqual(before); // порядок не тронут
    expect(room.state.faceUp.get(target)).toBe(false); // сторона инвертирована
    expect(room.state.faceUp.get(before[5])).toBe(true); // соседей не задело
  });

  it("ignores flips from a non-dealer", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });
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
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const card = room.state.deck[0];
    await leaveDealMode(room, dealer);

    let waiter = room.waitForMessage("flip_cards");
    dealer.send("flip_cards", { cards: [card] });
    await waiter;

    waiter = room.waitForMessage("reorder_deck");
    dealer.send("reorder_deck", { card, to: 20 });
    await waiter;

    expect(room.state.deck[20]).toBe(card);
    expect(room.state.faceUp.get(card)).toBe(false); // перевёрнутая сторона уехала с картой
  });

  // Клиент показывает переворот СРАЗУ, поэтому отказ обязан быть явным: иначе он
  // останется с картинкой, которой на сервере не существует.
  it("answers a rejected flip with a reason instead of staying silent", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });
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
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const rejects: any[] = [];
    dealer.onMessage("action_rejected", (m) => rejects.push(m));
    await leaveDealMode(room, dealer);

    const waiter = room.waitForMessage("flip_cards");
    dealer.send("flip_cards", { cards: ["джокер"] });
    await waiter;
    await new Promise((r) => setTimeout(r, 50));

    expect(rejects[0]?.reason).toBe("unknown_cards");
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

  it("toggle_deal_mode: выход из раздачи раскрывает колоду и закрывает руки", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });

    let waiter = room.waitForMessage("toggle_hand");
    second.send("toggle_hand");
    await waiter;
    expect(room.state.players.get(second.sessionId)!.handOpen).toBe(true);

    waiter = room.waitForMessage("toggle_deal_mode");
    dealer.send("toggle_deal_mode");
    await waiter;

    expect(room.state.dealMode).toBe(false); // вышли из раздачи
    expect([...room.state.faceUp.values()].every((v) => v === true)).toBe(true);
    expect(room.state.players.get(second.sessionId)!.handOpen).toBe(false); // руки приватные

    waiter = room.waitForMessage("toggle_deal_mode");
    dealer.send("toggle_deal_mode");
    await waiter;
    expect(room.state.dealMode).toBe(true);
    expect([...room.state.faceUp.values()].every((v) => v === false)).toBe(true);
  });

  it("ignores dealer-only powers from a regular player", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });

    let waiter = room.waitForMessage("toggle_deal_mode");
    second.send("toggle_deal_mode");
    await waiter;
    expect(room.state.dealMode).toBe(true); // не-дилер режим не переключил

    waiter = room.waitForMessage("collect_hands");
    second.send("collect_hands");
    await waiter;
    expect(room.state.deck.length).toBe(36);
  });
});
