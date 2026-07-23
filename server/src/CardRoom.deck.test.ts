import { describe, it, expect, vi } from "vitest";
import { TEST_PORTS, useTestServer } from "./roomHarness.js";

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
