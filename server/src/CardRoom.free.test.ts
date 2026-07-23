import { describe, it, expect, vi } from "vitest";
import { TEST_PORTS, useTestServer } from "./roomHarness.js";

vi.mock("./accounts.js", () => ({
  findAccountById: (id: string) => (id ? { id, name: "T", recoveryHash: "X", createdAt: 0 } : null),
}));

// Режим СВОБОДЫ: дилер жмёт «ГОУ!», и колода на столе становится общей — каждый тянет
// себе сам, раздавать в чужие руки не может никто, включая дилера.
describe("CardRoom: режим свободы", () => {
  const server = useTestServer(TEST_PORTS.free);

  it("go включает свободу и переводит комнату в игру, но колоду НЕ раздаёт", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    await server().connectTo(room, { name: "Bob" });

    const waiter = room.waitForMessage("go");
    dealer.send("go", {});
    await waiter;

    expect(room.state.freeMode).toBe(true);
    expect(room.state.phase).toBe("playing");
    expect(room.state.deck.length).toBe(36); // в отличие от start_game — карты остались на столе
  });

  // Смена режима стола в ЛЮБУЮ сторону сворачивает веер колоды: в игре колода уезжает в
  // свой слот, и оставшийся раскрытым веер повис бы в стороне маленькой «гармошкой».
  it("«ГОУ!» сворачивает веер колоды", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    let waiter = room.waitForMessage("set_deck_fanned");
    dealer.send("set_deck_fanned", { open: true });
    await waiter;
    expect(room.state.deckFanned).toBe(true);

    waiter = room.waitForMessage("go");
    dealer.send("go", {});
    await waiter;

    expect(room.state.deckFanned).toBe(false);
  });

  it("«Перераздача» тоже сворачивает веер колоды", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    let waiter = room.waitForMessage("go");
    dealer.send("go", {});
    await waiter;
    room.state.deckFanned = true; // кто-то раскрыл веер до сбора

    waiter = room.waitForMessage("collect_hands");
    dealer.send("collect_hands");
    await waiter;

    expect(room.state.deckFanned).toBe(false);
  });

  it("клич go_shout уходит ВСЕМ за столом, включая нажавшего", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const other = await server().connectTo(room, { name: "Bob" });

    const heard = Promise.all([
      new Promise((resolve) => dealer.onMessage("go_shout", resolve)),
      new Promise((resolve) => other.onMessage("go_shout", resolve)),
    ]);
    const waiter = room.waitForMessage("go");
    dealer.send("go", {});
    await waiter;
    await heard;
  });

  it("повторный go подгоняет стол ещё раз, состояния не меняет", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });

    let waiter = room.waitForMessage("go");
    dealer.send("go", {});
    await waiter;

    const again = new Promise((resolve) => dealer.onMessage("go_shout", resolve));
    waiter = room.waitForMessage("go");
    dealer.send("go", {});
    await waiter;
    await again;

    expect(room.state.freeMode).toBe(true);
    expect(room.state.phase).toBe("playing");
    expect(room.state.deck.length).toBe(36);
  });

  it("go доступен только дилеру", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    await server().connectTo(room, { name: "Alice" });
    const other = await server().connectTo(room, { name: "Bob" });

    const waiter = room.waitForMessage("go");
    other.send("go", {});
    await waiter;

    expect(room.state.freeMode).toBe(false);
    expect(room.state.phase).toBe("lobby");
  });

  it("take_card: игрок сам берёт верхнюю карту со стола", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const player = await server().connectTo(room, { name: "Bob" });
    let waiter = room.waitForMessage("go");
    dealer.send("go", {});
    await waiter;

    const before = [...room.state.deck];
    const top = before[before.length - 1]!;
    const moved = new Promise<{ moves: { card: string; from: string; to: string }[] }>((resolve) => {
      dealer.onMessage("card_moved", (m) => resolve(m));
    });
    waiter = room.waitForMessage("take_card");
    player.send("take_card", {});
    await waiter;
    const fx = await moved;

    expect(room.state.players.get(player.sessionId)!.hand.toArray()).toEqual([top]);
    expect([...room.state.deck]).toEqual(before.slice(0, -1));
    expect(room.state.faceUp.get(top)).toBeUndefined(); // сторона в колоде больше не нужна
    expect(fx.moves).toEqual([{ card: top, from: "deck", to: player.sessionId }]);
  });

  it("take_card с позицией берёт карту из середины колоды", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const player = await server().connectTo(room, { name: "Bob" });
    let waiter = room.waitForMessage("go");
    dealer.send("go", {});
    await waiter;

    const before = [...room.state.deck];
    waiter = room.waitForMessage("take_card");
    player.send("take_card", { index: 5 });
    await waiter;

    expect(room.state.players.get(player.sessionId)!.hand.toArray()).toEqual([before[5]]);
    expect([...room.state.deck]).toEqual(before.filter((_, i) => i !== 5));
  });

  it("мусорная позиция ничего не берёт", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    let waiter = room.waitForMessage("go");
    dealer.send("go", {});
    await waiter;

    for (const index of [-1, 36, 2.5, Number.NaN, "пять" as unknown as number]) {
      waiter = room.waitForMessage("take_card");
      dealer.send("take_card", { index });
      await waiter;
    }

    expect(room.state.deck.length).toBe(36);
    expect(room.state.players.get(dealer.sessionId)!.hand.length).toBe(0);
  });

  it("двое тянут одновременно — карты РАЗНЫЕ, состав колоды сходится", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const player = await server().connectTo(room, { name: "Bob" });
    let waiter = room.waitForMessage("go");
    dealer.send("go", {});
    await waiter;

    const before = [...room.state.deck];
    // Сообщения комнаты обрабатываются по очереди: кто пришёл первым, тот взял верхнюю.
    waiter = room.waitForMessage("take_card");
    player.send("take_card", {});
    await waiter;
    waiter = room.waitForMessage("take_card");
    dealer.send("take_card", {});
    await waiter;

    const a = room.state.players.get(player.sessionId)!.hand.toArray();
    const b = room.state.players.get(dealer.sessionId)!.hand.toArray();
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    expect(a[0]).not.toBe(b[0]);
    expect([...room.state.deck, ...a, ...b].sort()).toEqual([...before].sort());
  });

  it("take_all забирает всю колоду со стола в свою руку", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const player = await server().connectTo(room, { name: "Bob" });
    let waiter = room.waitForMessage("go");
    dealer.send("go", {});
    await waiter;

    const before = [...room.state.deck];
    const moved = new Promise<{ moves: { card: string; from: string; to: string }[] }>((resolve) => {
      dealer.onMessage("card_moved", (m) => resolve(m));
    });
    waiter = room.waitForMessage("take_all");
    player.send("take_all", {});
    await waiter;
    const fx = await moved;

    const hand = room.state.players.get(player.sessionId)!.hand.toArray();
    expect(room.state.deck.length).toBe(0);
    expect(hand.length).toBe(36);
    expect(hand[0]).toBe(before[before.length - 1]); // сверху вниз, как если бы тянул по одной
    expect([...hand].sort()).toEqual([...before].sort());
    expect(fx.moves.length).toBe(36);
    expect(room.state.deckFanned).toBe(false);
  });

  it("take_all без режима свободы не работает", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const player = await server().connectTo(room, { name: "Alice" });

    const waiter = room.waitForMessage("take_all");
    player.send("take_all", {});
    await waiter;

    expect(room.state.deck.length).toBe(36);
    expect(room.state.players.get(player.sessionId)!.hand.length).toBe(0);
  });

  it("take_card без режима свободы не работает", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const player = await server().connectTo(room, { name: "Alice" });

    const waiter = room.waitForMessage("take_card");
    player.send("take_card", {});
    await waiter;

    expect(room.state.deck.length).toBe(36);
    expect(room.state.players.get(player.sessionId)!.hand.length).toBe(0);
  });

  it("take_card не работает, когда колоды нет на столе", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    let waiter = room.waitForMessage("go");
    dealer.send("go", {});
    await waiter;
    room.state.deckLocation = dealer.sessionId; // колоду унесли со стола

    waiter = room.waitForMessage("take_card");
    dealer.send("take_card", {});
    await waiter;

    expect(room.state.deck.length).toBe(36);
    expect(room.state.players.get(dealer.sessionId)!.hand.length).toBe(0);
  });

  it("пустая колода: тянуть нечего", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    let waiter = room.waitForMessage("go");
    dealer.send("go", {});
    await waiter;
    room.state.deck.clear();

    waiter = room.waitForMessage("take_card");
    dealer.send("take_card", {});
    await waiter;

    expect(room.state.players.get(dealer.sessionId)!.hand.length).toBe(0);
  });

  it("discard_card: игрок скидывает свою карту в сброс лицом вверх", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const player = await server().connectTo(room, { name: "Bob" });
    let waiter = room.waitForMessage("go");
    dealer.send("go", {});
    await waiter;
    waiter = room.waitForMessage("take_card");
    player.send("take_card", {});
    await waiter;
    const card = room.state.players.get(player.sessionId)!.hand[0]!;

    // Ждём именно полёт В СБРОС: до него по той же трубе прилетело взятие карты.
    const moved = new Promise<{ moves: { card: string; from: string; to: string }[] }>((resolve) => {
      dealer.onMessage("card_moved", (m) => {
        if (m.moves?.[0]?.to === "discard") resolve(m);
      });
    });
    waiter = room.waitForMessage("discard_card");
    player.send("discard_card", { card });
    await waiter;
    const fx = await moved;

    expect(room.state.players.get(player.sessionId)!.hand.length).toBe(0);
    expect(room.state.discard.toArray()).toEqual([card]);
    expect(room.state.faceUp.get(card)).toBe(true); // сыгранную карту видно всем
    expect(fx.moves).toEqual([{ card, from: player.sessionId, to: "discard" }]);
  });

  it("чужую карту в сброс не отправить, и вне свободы сброса нет", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const player = await server().connectTo(room, { name: "Bob" });
    let waiter = room.waitForMessage("go");
    dealer.send("go", {});
    await waiter;
    waiter = room.waitForMessage("take_card");
    player.send("take_card", {});
    await waiter;
    const card = room.state.players.get(player.sessionId)!.hand[0]!;

    waiter = room.waitForMessage("discard_card");
    dealer.send("discard_card", { card }); // карта чужая
    await waiter;
    expect(room.state.discard.length).toBe(0);

    waiter = room.waitForMessage("collect_hands");
    dealer.send("collect_hands"); // вышли из свободы
    await waiter;
    waiter = room.waitForMessage("discard_card");
    player.send("discard_card", { card });
    await waiter;
    expect(room.state.discard.length).toBe(0);
  });

  it("перераздача возвращает сброс в колоду", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    let waiter = room.waitForMessage("go");
    dealer.send("go", {});
    await waiter;
    waiter = room.waitForMessage("take_card");
    dealer.send("take_card", {});
    await waiter;
    const card = room.state.players.get(dealer.sessionId)!.hand[0]!;
    waiter = room.waitForMessage("discard_card");
    dealer.send("discard_card", { card });
    await waiter;
    expect(room.state.discard.length).toBe(1);

    waiter = room.waitForMessage("collect_hands");
    dealer.send("collect_hands");
    await waiter;

    expect(room.state.discard.length).toBe(0);
    expect(room.state.deck.length).toBe(36);
    expect([...room.state.faceUp.values()].every((v) => v === false)).toBe(true);
  });

  it("в свободе раздавать в чужие руки нельзя даже дилеру — отказ с причиной", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const other = await server().connectTo(room, { name: "Bob" });
    let waiter = room.waitForMessage("ready");
    other.send("ready");
    await waiter;
    waiter = room.waitForMessage("go");
    dealer.send("go", {});
    await waiter;

    const rejected = new Promise<{ reason: string }>((resolve) => {
      dealer.onMessage("action_rejected", (m) => resolve(m));
    });
    const card = room.state.deck[room.state.deck.length - 1]!;
    waiter = room.waitForMessage("deal_card");
    dealer.send("deal_card", { card, to: other.sessionId });
    await waiter;

    expect((await rejected).reason).toBe("free_mode");
    expect(room.state.deck.length).toBe(36);
    expect(room.state.players.get(other.sessionId)!.hand.length).toBe(0);
  });

  it("«Перераздача» (collect_hands) выводит комнату из свободы обратно в лобби", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const player = await server().connectTo(room, { name: "Bob" });
    let waiter = room.waitForMessage("go");
    dealer.send("go", {});
    await waiter;
    waiter = room.waitForMessage("take_card");
    player.send("take_card", {});
    await waiter;

    waiter = room.waitForMessage("collect_hands");
    dealer.send("collect_hands");
    await waiter;

    expect(room.state.freeMode).toBe(false);
    expect(room.state.phase).toBe("lobby");
    expect(room.state.deck.length).toBe(36);
    expect(room.state.players.get(player.sessionId)!.hand.length).toBe(0);
  });
});
