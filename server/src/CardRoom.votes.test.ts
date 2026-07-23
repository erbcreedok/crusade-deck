import { describe, it, expect, vi } from "vitest";
import { TEST_PORTS, useTestServer } from "./roomHarness.js";

// Любой непустой accountId в тестах считаем валидным аккаунтом, чтобы onAuth вернул
// uid = accountId (в реале это findAccountById из accounts.json). Без мока onAuth
// свалился бы в guest-<sessionId> и не дал бы стабильной идентичности между входами.
vi.mock("./accounts.js", () => ({
  findAccountById: (id: string) => (id ? { id, name: "T", recoveryHash: "X", createdAt: 0 } : null),
}));

// Смена дилера и кик: большинство, таймаут (молчуны не считаются) и вес голоса дилера.
describe("CardRoom: голосования", () => {
  const server = useTestServer(TEST_PORTS.votes);

  it("propose_dealer + majority vote transfers the dealer badge", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });

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
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const target = await server().connectTo(room, { name: "Bob" });

    const waiter = room.waitForMessage("propose_kick");
    dealer.send("propose_kick", { targetSessionId: target.sessionId });
    await waiter;

    // У дилера вес 1.5 — этого одного голоса уже достаточно для большинства
    // при total = 2.5 (дилер 1.5 + цель 1).
    expect(room.state.players.has(target.sessionId)).toBe(false);
  });

  it("excludes non-voters once the vote deadline passes, deciding on cast votes only", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const proposer = await server().connectTo(room, { name: "Alice" });
    const target = await server().connectTo(room, { name: "Bob" });
    // Третий игрок молчит и никогда не голосует.
    await server().connectTo(room, { name: "Silent" });

    const waiter = room.waitForMessage("propose_kick");
    proposer.send("propose_kick", { targetSessionId: target.sessionId });
    await waiter;

    // Сразу после предложения большинства ещё нет (1 голос "за" из 3.5 общего веса).
    expect(room.state.activeProposal?.proposerId).toBeTruthy();

    // Ждём дольше, чем VOTE_TIMEOUT_MS (150мс), чтобы таймаут форсированно разрешил голосование.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(room.state.players.has(target.sessionId)).toBe(false);
  });

  it("перевес дилера в голосовании больше не даёт ему вето: двое обычных решают", async () => {
    const room = await server().createRoom("card_room", { deckType: "36" });
    const dealer = await server().connectTo(room, { name: "Alice" });
    const second = await server().connectTo(room, { name: "Bob" });
    const third = await server().connectTo(room, { name: "Carol" });

    // Двое обычных за то, чтобы кикнуть дилера: их 2 против его 1.01.
    let waiter = room.waitForMessage("propose_kick");
    second.send("propose_kick", { targetSessionId: dealer.sessionId });
    await waiter;

    waiter = room.waitForMessage("vote");
    third.send("vote", { value: true });
    await waiter;

    expect(room.state.players.has(dealer.sessionId)).toBe(false);
  });
});
