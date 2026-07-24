import { describe, it, expect } from "vitest";
import { sortBySuit, sortByRank } from "./sortHand";

const HAND = ["K♠", "A♥", "3♦", "10♣", "2♠", "Q♥"];

describe("sortBySuit / sortByRank", () => {
  it("состав не меняется", () => {
    const bySuit = sortBySuit(HAND);
    const byRank = sortByRank(HAND);
    expect([...bySuit].sort()).toEqual([...HAND].sort());
    expect([...byRank].sort()).toEqual([...HAND].sort());
  });

  it("по масти: ♠♥♦♣, внутри масти по номиналу", () => {
    expect(sortBySuit(HAND)).toEqual(["2♠", "K♠", "Q♥", "A♥", "3♦", "10♣"]);
  });

  it("по номиналу: сначала ранг, потом масть", () => {
    expect(sortByRank(HAND)).toEqual(["2♠", "3♦", "10♣", "Q♥", "K♠", "A♥"]);
  });

  it("джокеры и мусор не роняют сортировку — уходят в конец", () => {
    const withJunk = ["A♠", "🃏", "???", "2♥"];
    expect(sortBySuit(withJunk).slice(0, 2)).toEqual(["A♠", "2♥"]);
    expect(sortByRank(withJunk).slice(0, 2)).toEqual(["2♥", "A♠"]);
  });

  it("пустая рука безопасна", () => {
    expect(sortBySuit([])).toEqual([]);
    expect(sortByRank([])).toEqual([]);
  });
});
