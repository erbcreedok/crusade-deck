import { describe, it, expect, vi } from "vitest";
import { TEST_PORTS, useTestServer } from "./roomHarness.js";

vi.mock("./accounts.js", () => ({
  findAccountById: (id: string) => (id ? { id, name: "T", recoveryHash: "X", createdAt: 0 } : null),
}));

// ИГРАЛЬНАЯ ЗОНА: средний бокс стола, куда выкладывают карты из рук. Зона — список
// кучек; правил игры нет, поэтому взаимодействовать может любой игрок, а не только тот,
// чей ход (очерёдность появится отдельным слоем).
describe("CardRoom: игральная зона", () => {
  const server = useTestServer(TEST_PORTS.play);

  /** Комната в игре («ГОУ!»), у первого игрока на руках нужные карты. */
  async function inGame(hand: string[] = ["A♠", "K♥"]) {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const bob = await server().connectTo(room, { name: "Bob" });
    const waiter = room.waitForMessage("go");
    dealer.send("go", {});
    await waiter;
    const player = room.state.players.get(dealer.sessionId)!;
    hand.forEach((card) => player.hand.push(card));
    return { room, dealer, bob };
  }

  function zone(room: { state: { play: { cards: { toArray(): string[] } }[] } }): string[][] {
    return room.state.play.map((s) => s.cards.toArray());
  }

  it("play_card выкладывает карту из руки НОВОЙ кучкой", async () => {
    const { room, dealer } = await inGame();
    const waiter = room.waitForMessage("play_card");
    dealer.send("play_card", { card: "A♠" });
    await waiter;

    expect(zone(room)).toEqual([["A♠"]]);
    expect(room.state.players.get(dealer.sessionId)!.hand.toArray()).toEqual(["K♥"]);
  });

  it("выложенная карта лежит ЛИЦОМ ВВЕРХ — её видят все", async () => {
    const { room, dealer } = await inGame();
    const waiter = room.waitForMessage("play_card");
    dealer.send("play_card", { card: "A♠" });
    await waiter;

    expect(room.state.faceUp.get("A♠")).toBe(true);
  });

  it("play_card с индексом кладёт карту в указанную кучку", async () => {
    const { room, dealer } = await inGame();
    let waiter = room.waitForMessage("play_card");
    dealer.send("play_card", { card: "A♠" });
    await waiter;
    waiter = room.waitForMessage("play_card");
    dealer.send("play_card", { card: "K♥", stack: 0 });
    await waiter;

    expect(zone(room)).toEqual([["A♠", "K♥"]]);
  });

  it("выложить чужую карту нельзя — руку сервер проверяет", async () => {
    const { room, dealer } = await inGame();
    const waiter = room.waitForMessage("play_card");
    dealer.send("play_card", { card: "7♦" }); // карты нет в руке
    await waiter;

    expect(zone(room)).toEqual([]);
  });

  // В раздаче стол не размечен: игральной зоны на экране просто нет, класть некуда.
  it("в раздаче (до «ГОУ!») зона не принимает карты", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    room.state.players.get(dealer.sessionId)!.hand.push("A♠");

    const waiter = room.waitForMessage("play_card");
    dealer.send("play_card", { card: "A♠" });
    await waiter;

    expect(zone(room)).toEqual([]);
  });

  // Главное правило текущего слоя: зона общая. Bob кладёт в кучку, начатую дилером.
  it("в зону кладёт и забирает ЛЮБОЙ игрок, не только хозяин кучки", async () => {
    const { room, dealer, bob } = await inGame();
    room.state.players.get(bob.sessionId)!.hand.push("Q♣");

    let waiter = room.waitForMessage("play_card");
    dealer.send("play_card", { card: "A♠" });
    await waiter;
    waiter = room.waitForMessage("play_card");
    bob.send("play_card", { card: "Q♣", stack: 0 });
    await waiter;
    expect(zone(room)).toEqual([["A♠", "Q♣"]]);

    waiter = room.waitForMessage("take_play");
    bob.send("take_play", { card: "A♠" }); // забирает ЧУЖУЮ выложенную карту
    await waiter;

    expect(zone(room)).toEqual([["Q♣"]]);
    expect(room.state.players.get(bob.sessionId)!.hand.toArray()).toContain("A♠");
  });

  it("забранная из зоны последняя карта убирает пустую кучку", async () => {
    const { room, dealer } = await inGame();
    let waiter = room.waitForMessage("play_card");
    dealer.send("play_card", { card: "A♠" });
    await waiter;

    waiter = room.waitForMessage("take_play");
    dealer.send("take_play", { card: "A♠" });
    await waiter;

    expect(zone(room)).toEqual([]);
  });

  it("clear_play сгребает всю зону в сброс", async () => {
    const { room, dealer } = await inGame();
    let waiter = room.waitForMessage("play_card");
    dealer.send("play_card", { card: "A♠" });
    await waiter;
    waiter = room.waitForMessage("play_card");
    dealer.send("play_card", { card: "K♥" });
    await waiter;

    waiter = room.waitForMessage("clear_play");
    dealer.send("clear_play");
    await waiter;

    expect(zone(room)).toEqual([]);
    expect(room.state.discard.toArray()).toEqual(["A♠", "K♥"]);
  });

  it("«Перераздача» возвращает карты из зоны в колоду, а не теряет их", async () => {
    const { room, dealer } = await inGame();
    const waiter0 = room.waitForMessage("play_card");
    dealer.send("play_card", { card: "A♠" });
    await waiter0;

    const waiter = room.waitForMessage("collect_hands");
    dealer.send("collect_hands");
    await waiter;

    expect(zone(room)).toEqual([]);
    expect(room.state.deck.toArray()).toContain("A♠");
    expect(room.state.faceUp.get("A♠")).toBe(false); // в колоде всё рубашкой вверх
  });

  it("card_moved рассказывает всем, куда уехала карта", async () => {
    const { room, dealer, bob } = await inGame();
    const moved = new Promise<{ moves: { card: string; from: string; to: string }[] }>((resolve) => {
      bob.onMessage("card_moved", (m) => resolve(m)); // важно, что видит ЧУЖОЙ клиент
    });
    const waiter = room.waitForMessage("play_card");
    dealer.send("play_card", { card: "A♠" });
    await waiter;

    expect((await moved).moves).toEqual([{ card: "A♠", from: dealer.sessionId, to: "play" }]);
  });
});
