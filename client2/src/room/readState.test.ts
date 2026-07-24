import { describe, expect, it } from "vitest";
import { readFacing, readPlayers, readProposal, readRoomState } from "./readState";

// Подставная схема: у Colyseus MapSchema есть forEach(value, key) и get(key) — этого хватает.
function fakeMap<T>(entries: Record<string, T>) {
  return {
    forEach: (fn: (v: T, k: string) => void) => Object.entries(entries).forEach(([k, v]) => fn(v, k)),
    get: (k: string) => entries[k],
  };
}

function fakeState(over: Record<string, unknown> = {}) {
  return {
    players: fakeMap({
      me: { name: "Я", isDealer: true, isReady: false, connected: true, hand: ["A♠", "K♥"] },
      bot: { name: "Бот", isBot: true, isReady: true, connected: true, hand: ["Q♦"], handOpen: true },
    }),
    seatOrder: ["me", "bot"],
    inviteCode: "ABCD",
    isPublic: true,
    phase: "lobby",
    deckRev: 7,
    deck: ["2♣", "3♣"],
    faceUp: fakeMap({ "2♣": true, "3♣": false }),
    deckLocation: "center",
      deckFanned: false,
    ...over,
  };
}

describe("readPlayers", () => {
  it("разворачивает схему в обычные объекты", () => {
    const [me, bot] = readPlayers(fakeState());
    expect(me).toMatchObject({ id: "me", name: "Я", isDealer: true, isBot: false, handCount: 2 });
    expect(me!.hand).toEqual(["A♠", "K♥"]);
    expect(bot).toMatchObject({ id: "bot", isBot: true, handOpen: true, handCount: 1 });
  });

  it("отсутствующие флаги читаются как false, а не undefined", () => {
    const [me] = readPlayers(fakeState());
    expect(me!.handOpen).toBe(false);
    expect(me!.handFanned).toBe(false);
  });

  it("игрок без руки — ноль карт, а не падение", () => {
    const state = { players: fakeMap({ x: { name: "X" } }) };
    expect(readPlayers(state)[0]).toMatchObject({ handCount: 0, hand: [] });
  });
});

describe("readProposal", () => {
  it("пустая заглушка схемы — это «нет голосования»", () => {
    expect(readProposal({ activeProposal: { proposerId: "", votes: fakeMap({}) } })).toBeNull();
    expect(readProposal({})).toBeNull();
  });

  it("живое голосование читается вместе с голосами", () => {
    const p = readProposal({
      activeProposal: {
        kind: "kick",
        proposerId: "me",
        targetId: "bot",
        deadline: 123,
        votes: fakeMap({ me: true, bot: false }),
      },
    });
    expect(p).toEqual({
      kind: "kick",
      proposerId: "me",
      targetId: "bot",
      deadline: 123,
      votes: { me: true, bot: false },
    });
  });
});

describe("readFacing", () => {
  it("карта → лицом ли вверх", () => {
    expect(readFacing(fakeState())).toEqual({ "2♣": true, "3♣": false });
  });

  it("без faceUp — пустая карта сторон", () => {
    expect(readFacing({})).toEqual({});
  });
});

describe("readRoomState", () => {
  it("собирает снимок комнаты для конкретного зрителя", () => {
    const s = readRoomState(fakeState(), "me");
    expect(s.myHand).toEqual(["A♠", "K♥"]);
    expect(s.seatOrder).toEqual(["me", "bot"]);
    expect(s.deckRev).toBe(7);
    expect(s.deck).toEqual(["2♣", "3♣"]);
  });

  it("без seatOrder порядок мест берётся из списка игроков", () => {
    const s = readRoomState(fakeState({ seatOrder: undefined }), "me");
    expect(s.seatOrder).toEqual(["me", "bot"]);
  });

  it("зритель без места видит пустую руку", () => {
    expect(readRoomState(fakeState(), "нет-такого").myHand).toEqual([]);
  });
});
