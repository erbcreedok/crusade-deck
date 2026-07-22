import { describe, it, expect } from "vitest";
import { swipeStrength, swipeCardCount, swipeDirections } from "./swipeShuffle";
import { anim } from "./anim/config";

const s = anim.swipe;

describe("swipeStrength", () => {
  it("вялое движение силы не даёт, очень быстрое упирается в 1", () => {
    expect(swipeStrength(0, -s.minSpeed * 0.5)).toBe(0);
    expect(swipeStrength(0, -s.maxSpeed * 3)).toBe(1);
  });

  it("растёт со скоростью", () => {
    const slow = swipeStrength(0, -(s.minSpeed + 200));
    const fast = swipeStrength(0, -(s.maxSpeed - 200));
    expect(fast).toBeGreaterThan(slow);
  });

  it("считает полную скорость, а не только вертикальную", () => {
    const v = s.minSpeed + 400;
    expect(swipeStrength(v, -v)).toBeGreaterThan(swipeStrength(0, -v));
  });
});

describe("swipeCardCount", () => {
  it("от слабого свайпа вылетает минимум карт, от сильного — максимум", () => {
    expect(swipeCardCount(0)).toBe(s.minCards);
    expect(swipeCardCount(1)).toBe(s.maxCards);
  });

  it("всегда целое число в границах и растёт с силой", () => {
    let prev = 0;
    for (let k = 0; k <= 10; k++) {
      const n = swipeCardCount(k / 10);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(s.minCards);
      expect(n).toBeLessThanOrEqual(s.maxCards);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });
});

describe("swipeDirections", () => {
  const unit = (d: { dx: number; dy: number }) => Math.hypot(d.dx, d.dy);

  it("сколько карт — столько направлений, все единичные", () => {
    const dirs = swipeDirections(5, 0, -2000);
    expect(dirs.length).toBe(5);
    for (const d of dirs) expect(unit(d)).toBeCloseTo(1, 10);
  });

  it("прямой свайп вверх разбрасывает карты симметрично в разные стороны", () => {
    const dirs = swipeDirections(6, 0, -2000);
    const meanX = dirs.reduce((a, d) => a + d.dx, 0) / dirs.length;
    expect(meanX).toBeCloseTo(0, 6);
    expect(Math.max(...dirs.map((d) => d.dx))).toBeGreaterThan(0.3); // разброс реальный
    expect(Math.min(...dirs.map((d) => d.dx))).toBeLessThan(-0.3);
    for (const d of dirs) expect(d.dy).toBeLessThan(0); // всё-таки вверх
  });

  it("свайп с наклоном вбок уносит карты преимущественно в ту сторону", () => {
    const right = swipeDirections(6, 1800, -1000);
    const left = swipeDirections(6, -1800, -1000);
    expect(right.reduce((a, d) => a + d.dx, 0)).toBeGreaterThan(0);
    expect(left.reduce((a, d) => a + d.dx, 0)).toBeLessThan(0);
  });

  it("чем сильнее наклон, тем плотнее пучок — карты летят кучнее в сторону свайпа", () => {
    const spread = (dirs: { dx: number; dy: number }[]) => {
      const ang = dirs.map((d) => Math.atan2(d.dy, d.dx));
      return Math.max(...ang) - Math.min(...ang);
    };
    expect(spread(swipeDirections(6, 1800, -600))).toBeLessThan(spread(swipeDirections(6, 0, -2000)));
  });

  it("вырожденные входы безопасны", () => {
    expect(swipeDirections(0, 0, -2000)).toEqual([]);
    expect(swipeDirections(3, 0, 0).length).toBe(3);
  });
});
