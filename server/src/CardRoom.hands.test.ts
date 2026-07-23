import { describe, it, expect, vi } from "vitest";
import { TEST_PORTS, useTestServer } from "./roomHarness.js";

// Любой непустой accountId в тестах считаем валидным аккаунтом, чтобы onAuth вернул
// uid = accountId (в реале это findAccountById из accounts.json). Без мока onAuth
// свалился бы в guest-<sessionId> и не дал бы стабильной идентичности между входами.
vi.mock("./accounts.js", () => ({
  findAccountById: (id: string) => (id ? { id, name: "T", recoveryHash: "X", createdAt: 0 } : null),
}));

// Раздача карт, свой порядок руки, открытая/закрытая рука, веер на месте и сбор
// карт обратно в колоду.
describe("CardRoom: руки игроков", () => {
  const server = useTestServer(TEST_PORTS.hands);

  // Рука имеет два режима: открытая (все видят то же, что и я) и закрытая (всем видна
  // только оборотка). Это состояние игрока — его видят все, поэтому оно в схеме.
  it("toggle_hand переключает режим руки и виден всем", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const player = await server().connectTo(room, { name: "Alice" });
    expect(room.state.players.get(player.sessionId)?.handOpen).toBe(false); // по умолчанию закрыта

    let waiter = room.waitForMessage("toggle_hand");
    player.send("toggle_hand");
    await waiter;
    expect(room.state.players.get(player.sessionId)?.handOpen).toBe(true);

    waiter = room.waitForMessage("toggle_hand");
    player.send("toggle_hand");
    await waiter;
    expect(room.state.players.get(player.sessionId)?.handOpen).toBe(false);
  });

  it("режим руки — личное дело каждого: сосед свой не трогает", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const a = await server().connectTo(room, { name: "Alice" });
    const b = await server().connectTo(room, { name: "Bob" });

    const waiter = room.waitForMessage("toggle_hand");
    a.send("toggle_hand");
    await waiter;

    expect(room.state.players.get(a.sessionId)?.handOpen).toBe(true);
    expect(room.state.players.get(b.sessionId)?.handOpen).toBe(false);
  });

  it("set_hand_fanned: веер своей руки виден всем, от handOpen не зависит", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const a = await server().connectTo(room, { name: "Alice" });
    const b = await server().connectTo(room, { name: "Bob" });
    expect(room.state.players.get(a.sessionId)?.handFanned).toBe(false);

    let waiter = room.waitForMessage("set_hand_fanned");
    a.send("set_hand_fanned", { open: true });
    await waiter;
    expect(room.state.players.get(a.sessionId)?.handFanned).toBe(true);
    expect(room.state.players.get(a.sessionId)?.handOpen).toBe(false); // веер ≠ открытая рука
    expect(room.state.players.get(b.sessionId)?.handFanned).toBe(false);

    waiter = room.waitForMessage("set_hand_fanned");
    b.send("set_hand_fanned", { open: true }); // сосед свой не трогает чужой
    await waiter;
    expect(room.state.players.get(a.sessionId)?.handFanned).toBe(true);
    expect(room.state.players.get(b.sessionId)?.handFanned).toBe(true);

    waiter = room.waitForMessage("set_hand_fanned");
    a.send("set_hand_fanned", { open: false });
    await waiter;
    expect(room.state.players.get(a.sessionId)?.handFanned).toBe(false);
  });

  it("collect_hands забирает карты у всех, прячет их и обнуляет приватность рук", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });

    let waiter = room.waitForMessage("start_game");
    dealer.send("start_game");
    await waiter;
    expect(room.state.deck.length).toBe(0);

    waiter = room.waitForMessage("toggle_hand");
    second.send("toggle_hand");
    await waiter;

    const collected = new Promise<{ order: string[]; counts: Record<string, number> }>((resolve) => {
      second.onMessage("hands_collected", (m) => resolve(m));
    });
    waiter = room.waitForMessage("collect_hands");
    dealer.send("collect_hands");
    await waiter;
    const fx = await collected;

    expect(room.state.deck.length).toBe(36); // все карты вернулись
    expect(room.state.players.get(dealer.sessionId)!.hand.length).toBe(0);
    expect(room.state.players.get(second.sessionId)!.hand.length).toBe(0);
    expect(room.state.players.get(second.sessionId)!.handOpen).toBe(false);
    expect([...room.state.faceUp.values()].every((v) => v === false)).toBe(true);
    expect(room.state.deckLocation).toBe("center"); // в режиме раздачи колода в центре
    expect(fx.order[0]).toBe(dealer.sessionId);
    expect(fx.counts[dealer.sessionId]! + fx.counts[second.sessionId]!).toBe(36);
  });

  it("deal_card отдаёт карту из колоды в руку игрока, порядок остальных цел", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });
    const before = [...room.state.deck];
    const card = before[before.length - 1]; // верхняя карта

    // Без «Готов» дроп-зона выключена — карта не уходит.
    let waiter = room.waitForMessage("deal_card");
    dealer.send("deal_card", { card, to: second.sessionId });
    await waiter;
    expect(room.state.deck.length).toBe(36);
    expect(room.state.players.get(second.sessionId)!.hand.length).toBe(0);

    waiter = room.waitForMessage("ready");
    second.send("ready");
    await waiter;

    const moved = new Promise<{ moves: { card: string; from: string; to: string }[] }>((resolve) => {
      second.onMessage("card_moved", (m) => resolve(m));
    });
    waiter = room.waitForMessage("deal_card");
    dealer.send("deal_card", { card, to: second.sessionId });
    await waiter;
    const fx = await moved;

    expect(room.state.players.get(second.sessionId)!.hand.toArray()).toEqual([card]);
    expect([...room.state.deck]).toEqual(before.slice(0, -1)); // остальные на местах
    expect(room.state.faceUp.get(card)).toBeUndefined(); // сторона в колоде больше не нужна
    expect(fx.moves).toEqual([{ card, from: "deck", to: second.sessionId }]);
  });

  it("deal_card дилеру себе: дилер всегда готов", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const card = room.state.deck[room.state.deck.length - 1]!;
    expect(room.state.players.get(dealer.sessionId)!.isReady).toBe(true);

    const waiter = room.waitForMessage("deal_card");
    dealer.send("deal_card", { card, to: dealer.sessionId });
    await waiter;

    expect(room.state.players.get(dealer.sessionId)!.hand.toArray()).toEqual([card]);
  });

  it("deal_card отбивает чужого отправителя, несуществующую карту и игрока", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });
    const before = [...room.state.deck];

    let waiter = room.waitForMessage("deal_card");
    second.send("deal_card", { card: before[0], to: second.sessionId }); // не дилер
    await waiter;
    expect(room.state.deck.length).toBe(36);

    const dealer2 = await server().createRoom("card_room", { deckType: "36" });
    const d = await server().connectTo(dealer2, { name: "Carol" });
    waiter = dealer2.waitForMessage("deal_card");
    d.send("deal_card", { card: "нет такой", to: d.sessionId });
    await waiter;
    expect(dealer2.state.deck.length).toBe(36);

    waiter = dealer2.waitForMessage("deal_card");
    d.send("deal_card", { card: dealer2.state.deck[0], to: "не-игрок" });
    await waiter;
    expect(dealer2.state.deck.length).toBe(36);
  });

  it("set_hand_order принимает перестановку своей руки и отбивает подмену", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const cards = [room.state.deck[35], room.state.deck[34], room.state.deck[33]];
    for (const card of cards) {
      const w = room.waitForMessage("deal_card");
      dealer.send("deal_card", { card, to: dealer.sessionId });
      await w;
    }
    const me = room.state.players.get(dealer.sessionId)!;
    expect(me.hand.length).toBe(3);

    const sorted = [...me.hand.toArray()].reverse();
    let waiter = room.waitForMessage("set_hand_order");
    dealer.send("set_hand_order", { order: sorted });
    await waiter;
    expect(me.hand.toArray()).toEqual(sorted);

    waiter = room.waitForMessage("set_hand_order");
    dealer.send("set_hand_order", { order: ["K♦", ...sorted.slice(1)] }); // подмена
    await waiter;
    expect(me.hand.toArray()).toEqual(sorted); // не принято
  });
});
