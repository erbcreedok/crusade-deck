import { describe, expect, it } from "vitest";
import { buildDeck, normalizeDeckType, RANKS_36, RANKS_52, SUITS } from "./deckBuild.js";

describe("buildDeck", () => {
  it("36 карт: четыре масти по девять рангов", () => {
    const deck = buildDeck("36");
    expect(deck).toHaveLength(SUITS.length * RANKS_36.length);
    expect(deck).toHaveLength(36);
  });

  it("52 карты — с двойками по пятёрки", () => {
    const deck = buildDeck("52");
    expect(deck).toHaveLength(SUITS.length * RANKS_52.length);
    expect(deck).toContain("2♠");
    expect(buildDeck("36")).not.toContain("2♠");
  });

  it("без повторов — иначе движок не развёл бы карты-близнецы", () => {
    const deck = buildDeck("52");
    expect(new Set(deck).size).toBe(deck.length);
  });

  it("порядок детерминированный: две сборки совпадают", () => {
    expect(buildDeck("36")).toEqual(buildDeck("36"));
  });

  it("масть идёт целиком, потом следующая", () => {
    const deck = buildDeck("36");
    expect(deck.slice(0, RANKS_36.length).every((c) => c.endsWith("♠"))).toBe(true);
  });
});

describe("normalizeDeckType", () => {
  it("52 распознаётся, всё остальное — 36", () => {
    expect(normalizeDeckType("52")).toBe("52");
    expect(normalizeDeckType("36")).toBe("36");
    expect(normalizeDeckType(undefined)).toBe("36");
    expect(normalizeDeckType("100")).toBe("36");
    expect(normalizeDeckType(52)).toBe("36"); // именно строка, не число
  });
});
