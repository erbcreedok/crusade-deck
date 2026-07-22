import { describe, it, expect } from "vitest";
import { moveCard } from "./deckOrder.js";

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
