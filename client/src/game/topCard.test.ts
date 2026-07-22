import { describe, it, expect } from "vitest";
import { dealSourceIndex, topCard } from "./topCard";

describe("topCard", () => {
  it("верх — последняя в массиве", () => {
    expect(topCard(["A♠", "2♠", "3♠"])).toBe("3♠");
  });

  it("пустая колода — нечего брать", () => {
    expect(topCard([])).toBeNull();
  });

  it("одна карта — она и есть верх", () => {
    expect(topCard(["K♦"])).toBe("K♦");
  });
});

describe("dealSourceIndex", () => {
  it("стопка — всегда верх (последний индекс)", () => {
    expect(dealSourceIndex(5, false, 1)).toBe(4);
  });

  it("веер — индекс под пальцем", () => {
    expect(dealSourceIndex(5, true, 2)).toBe(2);
  });

  it("веер — индекс зажимается в границы", () => {
    expect(dealSourceIndex(5, true, -3)).toBe(0);
    expect(dealSourceIndex(5, true, 99)).toBe(4);
  });
});
