import { describe, expect, it } from "vitest";
import { DEALER_VOTE_WEIGHT, tallyVotes, voteWeight } from "./voteWeight";

const alice = { id: "a", isDealer: false, connected: true };
const bob = { id: "b", isDealer: false, connected: true };
const dealer = { id: "d", isDealer: true, connected: true };
const away = { id: "z", isDealer: false, connected: false };

describe("voteWeight", () => {
  it("обычный игрок весит 1, дилер — чуть больше", () => {
    expect(voteWeight(alice)).toBe(1);
    expect(voteWeight(dealer)).toBe(DEALER_VOTE_WEIGHT);
  });

  it("дилер решает только ничью: двое обычных перевешивают его", () => {
    expect(DEALER_VOTE_WEIGHT).toBeGreaterThan(1);
    expect(DEALER_VOTE_WEIGHT).toBeLessThan(2);
  });

  it("отключённый и неизвестный не голосуют", () => {
    expect(voteWeight(away)).toBe(0);
    expect(voteWeight(undefined)).toBe(0);
  });
});

describe("tallyVotes", () => {
  const table = [alice, bob, dealer, away];

  it("складывает «за» и «против» по весам", () => {
    const t = tallyVotes(table, { a: true, b: false, d: true });
    expect(t.yes).toBeCloseTo(1 + DEALER_VOTE_WEIGHT);
    expect(t.no).toBe(1);
  });

  it("знаменатель — вес всех сидящих, включая ещё не голосовавших", () => {
    expect(tallyVotes(table, {}).total).toBeCloseTo(2 + DEALER_VOTE_WEIGHT);
  });

  it("голос отключившегося не учитывается ни в одну сторону", () => {
    const t = tallyVotes(table, { z: true });
    expect(t.yes).toBe(0);
    expect(t.no).toBe(0);
  });

  it("дилер против двоих обычных проигрывает", () => {
    const t = tallyVotes(table, { a: true, b: true, d: false });
    expect(t.yes).toBeGreaterThan(t.no);
  });
});
