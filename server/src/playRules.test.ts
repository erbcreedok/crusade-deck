import { describe, expect, it } from "vitest";
import { clearPlay, playCard, playCards, takeFromPlay } from "./playRules.js";

describe("playCard", () => {
  it("кладёт карту из руки НОВЫМ массивом, когда стопка не указана", () => {
    const out = playCard(["A♠", "K♥"], [], "A♠");
    expect(out).toEqual({ hand: ["K♥"], stacks: [["A♠"]] });
  });

  it("кладёт карту в указанный массив поверх лежащих", () => {
    const out = playCard(["A♠"], [["7♣"], ["8♦"]], "A♠", 0);
    expect(out).toEqual({ hand: [], stacks: [["7♣", "A♠"], ["8♦"]] });
  });

  it("верх массива — последний элемент, как у колоды и сброса", () => {
    const out = playCard(["A♠"], [["7♣"]], "A♠", 0);
    expect(out?.stacks[0].at(-1)).toBe("A♠");
  });

  // Индекс приходит от клиента и мог устареть: пока палец летел, чужой «в сброс» мог
  // убрать эту стопку. Это не повод терять карту — она просто ложится новым массивом.
  it("индекс за пределами списка — карта ложится новым массивом, а не пропадает", () => {
    const out = playCard(["A♠"], [["7♣"]], "A♠", 9);
    expect(out).toEqual({ hand: [], stacks: [["7♣"], ["A♠"]] });
  });

  it("отрицательный индекс тоже читается как «новый массив»", () => {
    const out = playCard(["A♠"], [["7♣"]], "A♠", -1);
    expect(out?.stacks).toEqual([["7♣"], ["A♠"]]);
  });

  it("чужую карту выложить нельзя", () => {
    expect(playCard(["K♥"], [], "A♠")).toBeNull();
  });

  it("не мутирует переданные руку и стопки", () => {
    const hand = ["A♠"];
    const stacks = [["7♣"]];
    playCard(hand, stacks, "A♠", 0);
    expect(hand).toEqual(["A♠"]);
    expect(stacks).toEqual([["7♣"]]);
  });
});

describe("takeFromPlay", () => {
  it("забирает карту из середины массива — копаться разрешено", () => {
    const out = takeFromPlay([["7♣", "8♦", "9♥"]], "8♦");
    expect(out).toEqual({ stacks: [["7♣", "9♥"]], card: "8♦" });
  });

  it("находит карту в любом массиве, не только в первом", () => {
    const out = takeFromPlay([["7♣"], ["8♦"]], "8♦");
    expect(out?.stacks).toEqual([["7♣"]]);
  });

  // Пустая ячейка в сетке — призрак: место занимает, а показать ей нечего. Поэтому
  // опустевший массив исчезает из списка, а не остаётся дыркой.
  it("опустевший массив исчезает из списка", () => {
    const out = takeFromPlay([["7♣"], ["8♦"]], "7♣");
    expect(out?.stacks).toEqual([["8♦"]]);
  });

  it("карты в зоне нет — забирать нечего", () => {
    expect(takeFromPlay([["7♣"]], "A♠")).toBeNull();
  });

  it("не мутирует переданные стопки", () => {
    const stacks = [["7♣", "8♦"]];
    takeFromPlay(stacks, "7♣");
    expect(stacks).toEqual([["7♣", "8♦"]]);
  });
});

describe("clearPlay", () => {
  it("сгребает всю зону в сброс: по массивам слева направо, снизу вверх", () => {
    expect(clearPlay([["7♣", "8♦"], ["9♥"]], ["A♠"])).toEqual(["A♠", "7♣", "8♦", "9♥"]);
  });

  it("пустая зона сброс не трогает", () => {
    expect(clearPlay([], ["A♠"])).toEqual(["A♠"]);
  });
});

describe("playCards", () => {
  it("разворачивает зону в плоский список — для перераздачи", () => {
    expect(playCards([["7♣", "8♦"], ["9♥"]])).toEqual(["7♣", "8♦", "9♥"]);
  });
});
