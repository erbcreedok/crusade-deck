import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { boot, ColyseusTestServer } from "@colyseus/testing";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { CardRoom } from "./CardRoom.js";

// Короткий таймаут голосования — тесты не должны ждать реальные 10 секунд.
// CardRoom.ts читает VOTE_TIMEOUT_MS "лениво" (при каждом голосовании), а
// не один раз при загрузке модуля, ровно ради этого.
process.env.VOTE_TIMEOUT_MS = "150";

function createGameServer() {
  const server = new Server({ transport: new WebSocketTransport() });
  server.define("card_room", CardRoom);
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

  it("shuffle_deck (dealer) keeps the same cards, only reorders them", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    const dealer = await colyseus.connectTo(room, { name: "Alice" });
    const before = [...room.state.deck].sort();

    const waiter = room.waitForMessage("shuffle_deck");
    dealer.send("shuffle_deck");
    await waiter;

    const after = [...room.state.deck].sort();
    expect(after).toEqual(before);
    expect(room.state.deck.length).toBe(36);
  });

  it("ignores shuffle_deck from a non-dealer", async () => {
    const room = await colyseus.createRoom("card_room", { deckType: "36" });
    await colyseus.connectTo(room, { name: "Alice" });
    const second = await colyseus.connectTo(room, { name: "Bob" });
    const before = [...room.state.deck];

    const waiter = room.waitForMessage("shuffle_deck");
    second.send("shuffle_deck");
    await waiter;

    // Порядок не должен был поменяться — сообщение проигнорировано.
    expect([...room.state.deck]).toEqual(before);
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
});
