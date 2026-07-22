import { describe, it, expect } from "vitest";
import { cardsUnderTouch } from "./touch";

const row = [
  { x: 0, y: 0 },
  { x: 30, y: 0 },
  { x: 60, y: 0 },
  { x: 200, y: 0 },
];

describe("cardsUnderTouch", () => {
  it("палец «толстый»: захватывает не одну карту, а всё в радиусе", () => {
    expect(cardsUnderTouch(row, 30, 0, 35)).toEqual([0, 1, 2]);
  });

  it("далёкие карты не задевает", () => {
    expect(cardsUnderTouch(row, 30, 0, 35)).not.toContain(3);
  });

  it("радиус круговой — учитывается и вертикаль", () => {
    expect(cardsUnderTouch(row, 0, 40, 35)).toEqual([]);
    expect(cardsUnderTouch(row, 0, 20, 35)).toEqual([0]); // соседка уже в 36px — мимо
    expect(cardsUnderTouch(row, 0, 20, 40)).toEqual([0, 1]);
  });

  it("точное попадание в карту берёт хотя бы её", () => {
    expect(cardsUnderTouch(row, 200, 0, 5)).toEqual([3]);
  });

  it("индексы идут по возрастанию, вырожденные входы безопасны", () => {
    const out = cardsUnderTouch(row, 45, 0, 100);
    expect(out).toEqual([...out].sort((a, b) => a - b));
    expect(cardsUnderTouch([], 0, 0, 50)).toEqual([]);
    expect(cardsUnderTouch(row, 0, 0, 0)).toEqual([0]);
  });
});
