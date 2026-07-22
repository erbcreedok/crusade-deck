import { describe, it, expect } from "vitest";
import { moveCard, scatterCards } from "./deckOrder.js";

const deck = ["A♠", "2♠", "3♠", "4♠", "5♠"];

describe("moveCard", () => {
  it("двигает карту вперёд и назад по колоде", () => {
    expect(moveCard(deck, "A♠", 2)).toEqual(["2♠", "3♠", "A♠", "4♠", "5♠"]);
    expect(moveCard(deck, "5♠", 1)).toEqual(["A♠", "5♠", "2♠", "3♠", "4♠"]);
  });

  it("на своё же место — без изменений; индекс за границами прижимается", () => {
    expect(moveCard(deck, "3♠", 2)).toEqual(deck);
    expect(moveCard(deck, "A♠", 99)).toEqual(["2♠", "3♠", "4♠", "5♠", "A♠"]);
    expect(moveCard(deck, "5♠", -3)).toEqual(["5♠", "A♠", "2♠", "3♠", "4♠"]);
  });

  it("карты нет в колоде — копия без изменений, исходник не мутируется", () => {
    const src = [...deck];
    expect(moveCard(src, "K♦", 0)).toEqual(deck);
    moveCard(src, "A♠", 3);
    expect(src).toEqual(deck);
  });
});

describe("scatterCards", () => {
  const deck = ["A♠", "2♠", "3♠", "4♠", "5♠", "6♠", "7♠"];
  // Детерминированный «рандом»: выдаёт заданную последовательность долей.
  const rng = (...vals: number[]) => {
    let i = 0;
    return () => vals[i++ % vals.length];
  };

  it("остальные карты сохраняют порядок ОТНОСИТЕЛЬНО ДРУГ ДРУГА", () => {
    const out = scatterCards(deck, ["2♠", "5♠"], rng(0, 0.99));
    const rest = out.filter((c) => c !== "2♠" && c !== "5♠");
    expect(rest).toEqual(["A♠", "3♠", "4♠", "6♠", "7♠"]);
  });

  it("набор карт не меняется — ничего не теряется и не задваивается", () => {
    const out = scatterCards(deck, ["3♠", "4♠", "7♠"], rng(0.1, 0.5, 0.9));
    expect([...out].sort()).toEqual([...deck].sort());
    expect(out.length).toBe(deck.length);
  });

  it("выброшенные карты встают на новые места по рандому", () => {
    const out = scatterCards(deck, ["7♠"], rng(0));
    expect(out[0]).toBe("7♠"); // доля 0 → в самое начало
    expect(scatterCards(deck, ["A♠"], rng(1))[deck.length - 1]).toBe("A♠"); // доля 1 → в конец
  });

  it("пустой список и неизвестные карты — колода без изменений", () => {
    expect(scatterCards(deck, [], rng(0.5))).toEqual(deck);
    expect(scatterCards(deck, ["нет такой"], rng(0.5))).toEqual(deck);
  });

  it("исходный массив не мутируется", () => {
    const src = [...deck];
    scatterCards(src, ["3♠"], rng(0.2));
    expect(src).toEqual(deck);
  });
});
