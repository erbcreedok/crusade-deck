import { describe, it, expect } from "vitest";
import { parseCard, isCourt, suitColor } from "./card";

describe("parseCard", () => {
  it("разбирает ранг и масть, включая '10'", () => {
    expect(parseCard("10♠")).toEqual({ rank: "10", suit: "♠" });
    expect(parseCard("A♥")).toEqual({ rank: "A", suit: "♥" });
    expect(parseCard("K♦")).toEqual({ rank: "K", suit: "♦" });
    expect(parseCard("6♣")).toEqual({ rank: "6", suit: "♣" });
  });
});

describe("isCourt", () => {
  it("J/Q/K — картинки, остальные нет", () => {
    expect(isCourt("J")).toBe(true);
    expect(isCourt("Q")).toBe(true);
    expect(isCourt("K")).toBe(true);
    expect(isCourt("A")).toBe(false);
    expect(isCourt("10")).toBe(false);
  });
});

describe("suitColor", () => {
  it("классика: ♥♦ красные, ♠♣ чёрные", () => {
    const red = suitColor("♥", false);
    expect(suitColor("♦", false)).toBe(red);
    const black = suitColor("♠", false);
    expect(suitColor("♣", false)).toBe(black);
    expect(red).not.toBe(black);
  });

  it("четырёхцветная: все четыре масти различимы (♦ оранж, ♣ голубой)", () => {
    const colors = [suitColor("♠", true), suitColor("♥", true), suitColor("♦", true), suitColor("♣", true)];
    expect(new Set(colors).size).toBe(4); // все разные
    expect(suitColor("♦", true)).not.toBe(suitColor("♥", true)); // бубны ≠ черви
    expect(suitColor("♣", true)).not.toBe(suitColor("♠", true)); // трефы ≠ пики
  });
});
