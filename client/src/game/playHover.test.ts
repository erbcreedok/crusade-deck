import { describe, expect, it } from "vitest";
import { playGrid } from "./playGrid";
import { playHoverAdjust } from "./playHover";
import type { RoundedRect } from "./layout";

const ZONE: RoundedRect = { cx: 200, cy: 150, w: 300, h: 200, r: 8 };
const GRID = playGrid(ZONE, 60, 86, 6);

describe("playHoverAdjust", () => {
  it("никого не наводят — стол стоит как стоял", () => {
    for (let i = 0; i < 6; i++) {
      expect(playHoverAdjust(GRID, null, i)).toEqual({ dx: 0, dy: 0, scale: 1 });
    }
  });

  it("кучка под пальцем приподнимается и подрастает", () => {
    const a = playHoverAdjust(GRID, 2, 2);
    expect(a.dy).toBeLessThan(0); // «вверх» на экране — это меньший y
    expect(a.scale).toBeGreaterThan(1);
  });

  // Ради этого всё и делается: сосед отодвигается ОТ наведённой кучки, открывая её края,
  // чтобы было видно, куда именно уедет карта.
  it("сосед справа отодвигается вправо, сосед слева — влево", () => {
    const grid = playGrid(ZONE, 60, 86, 3);
    const right = playHoverAdjust(grid, 1, 2);
    const left = playHoverAdjust(grid, 1, 0);
    expect(right.dx).toBeGreaterThan(0);
    expect(left.dx).toBeLessThan(0);
  });

  it("сосед снизу отодвигается вниз", () => {
    const below = GRID.cells.findIndex((c) => c.cy > GRID.cells[0]!.cy + 1);
    expect(below).toBeGreaterThan(0); // в сетке правда есть вторая строка
    expect(playHoverAdjust(GRID, 0, below).dy).toBeGreaterThan(0);
  });

  it("отодвигаются только соседи: дальняя кучка стоит на месте", () => {
    const near = playHoverAdjust(GRID, 0, 1);
    const far = playHoverAdjust(GRID, 0, 5);
    expect(Math.hypot(near.dx, near.dy)).toBeGreaterThan(Math.hypot(far.dx, far.dy));
  });

  it("соседи не растут — подрастает только наведённая", () => {
    expect(playHoverAdjust(GRID, 0, 1).scale).toBe(1);
  });

  // Индекс наведения приходит из хит-теста и мог устареть на кадр, если кучку в этот миг
  // забрали. Это не повод дёргать весь стол.
  it("наведение на несуществующую кучку ничего не двигает", () => {
    expect(playHoverAdjust(GRID, 99, 0)).toEqual({ dx: 0, dy: 0, scale: 1 });
  });

  it("пустая сетка не роняет расчёт", () => {
    const empty = playGrid({ cx: 0, cy: 0, w: 0, h: 0, r: 0 }, 60, 86, 0);
    expect(playHoverAdjust(empty, 0, 0)).toEqual({ dx: 0, dy: 0, scale: 1 });
  });
});
