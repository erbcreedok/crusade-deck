import { describe, it, expect } from "vitest";
import { moveCard, scatterCards, shuffleOrder, isPermutationOf } from "./deckOrder";

const deck = ["A♠", "2♠", "3♠", "4♠", "5♠"];

describe("moveCard", () => {
  it("двигает карту вперёд по колоде", () => {
    expect(moveCard(deck, "A♠", 2)).toEqual(["2♠", "3♠", "A♠", "4♠", "5♠"]);
  });

  it("двигает карту назад по колоде", () => {
    expect(moveCard(deck, "5♠", 1)).toEqual(["A♠", "5♠", "2♠", "3♠", "4♠"]);
  });

  it("на своё же место — порядок не меняется", () => {
    expect(moveCard(deck, "3♠", 2)).toEqual(deck);
  });

  it("индекс за границами — прижимается к краю", () => {
    expect(moveCard(deck, "A♠", 99)).toEqual(["2♠", "3♠", "4♠", "5♠", "A♠"]);
    expect(moveCard(deck, "5♠", -3)).toEqual(["5♠", "A♠", "2♠", "3♠", "4♠"]);
  });

  it("карты нет в колоде — копия без изменений", () => {
    expect(moveCard(deck, "K♦", 0)).toEqual(deck);
  });

  it("исходный массив не мутируется", () => {
    const src = [...deck];
    moveCard(src, "A♠", 3);
    expect(src).toEqual(deck);
  });
});

describe("scatterCards", () => {
  const rng = (...vals: number[]) => {
    let i = 0;
    return () => vals[i++ % vals.length];
  };

  it("остальные карты сохраняют порядок относительно друг друга", () => {
    const out = scatterCards(deck, ["2♠", "5♠"], rng(0, 0.99));
    expect(out.filter((c) => c !== "2♠" && c !== "5♠")).toEqual(["A♠", "3♠", "4♠"]);
  });

  it("набор карт не меняется", () => {
    const out = scatterCards(deck, ["3♠", "4♠"], rng(0.1, 0.9));
    expect([...out].sort()).toEqual([...deck].sort());
  });

  it("доля 0 кладёт карту в начало, доля 1 — в конец", () => {
    expect(scatterCards(deck, ["5♠"], rng(0))[0]).toBe("5♠");
    expect(scatterCards(deck, ["A♠"], rng(1))[deck.length - 1]).toBe("A♠");
  });

  it("пустой список и неизвестные карты ничего не меняют, исходник цел", () => {
    const src = [...deck];
    expect(scatterCards(src, [], rng(0.5))).toEqual(deck);
    expect(scatterCards(src, ["K♦"], rng(0.5))).toEqual(deck);
    expect(src).toEqual(deck);
  });
});

describe("shuffleOrder", () => {
  it("сохраняет набор карт и длину", () => {
    const out = shuffleOrder(deck, () => 0.5);
    expect([...out].sort()).toEqual([...deck].sort());
    expect(out.length).toBe(deck.length);
  });

  it("реально меняет порядок", () => {
    let i = 0;
    const out = shuffleOrder(deck, () => [0.1, 0.9, 0.3, 0.7, 0.5][i++ % 5]);
    expect(out).not.toEqual(deck);
  });

  it("исходный массив не мутируется, вырожденные входы безопасны", () => {
    const src = [...deck];
    shuffleOrder(src, () => 0.3);
    expect(src).toEqual(deck);
    expect(shuffleOrder([], () => 0.3)).toEqual([]);
    expect(shuffleOrder(["A♠"], () => 0.99)).toEqual(["A♠"]);
  });
});

describe("isPermutationOf", () => {
  it("та же стопка в другом порядке — перестановка", () => {
    expect(isPermutationOf(["3♠", "A♠"], ["A♠", "3♠"])).toBe(true);
    expect(isPermutationOf([], [])).toBe(true);
  });

  it("другой состав или длина — нет", () => {
    expect(isPermutationOf(["A♠"], ["A♠", "3♠"])).toBe(false);
    expect(isPermutationOf(["A♠", "K♦"], ["A♠", "3♠"])).toBe(false);
    expect(isPermutationOf(["A♠", "A♠"], ["A♠", "3♠"])).toBe(false);
  });
});
