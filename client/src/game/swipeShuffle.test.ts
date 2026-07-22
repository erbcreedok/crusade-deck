import { describe, it, expect } from "vitest";
import { swipeStrength, swipeCardCount, swipeDirections, swipeVelocity, swipeCardIndices, isSwipeDown } from "./swipeShuffle";
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

describe("swipeVelocity", () => {
  // Скорость по ОКНУ выборок, а не по последней паре событий: одиночный рывок пальца
  // в конце медленного ведения не должен выглядеть как свайп.
  const track = (vy: number, n = 6, step = 16) =>
    Array.from({ length: n }, (_, i) => ({ x: 0, y: -vy * (i * step) * 0.001, t: i * step }));

  it("равномерное движение — та самая скорость", () => {
    const v = swipeVelocity(track(2000), 100);
    expect(v.vy).toBeCloseTo(-2000, 0);
    expect(v.vx).toBeCloseTo(0, 6);
  });

  it("рывок в конце медленного ведения не даёт скорости свайпа", () => {
    const slow = track(300, 6);
    const jerk = [...slow, { x: 0, y: slow[slow.length - 1].y - 60, t: 5 * 16 + 8 }];
    expect(Math.abs(swipeVelocity(jerk, 100).vy)).toBeLessThan(2000);
  });

  it("выборки старше окна не учитываются", () => {
    const old = [{ x: 0, y: 500, t: 0 }, ...track(1500).map((s) => ({ ...s, t: s.t + 400 }))];
    expect(swipeVelocity(old, 100).vy).toBeCloseTo(swipeVelocity(track(1500), 100).vy, 0);
  });

  it("одной выборки мало — скорости нет", () => {
    expect(swipeVelocity([{ x: 0, y: 0, t: 0 }], 100)).toEqual({ vx: 0, vy: 0 });
    expect(swipeVelocity([], 100)).toEqual({ vx: 0, vy: 0 });
  });
});

describe("swipeCardIndices", () => {
  it("берёт соседние карты вокруг точки свайпа, а не по всей колоде", () => {
    expect(swipeCardIndices(20, 5, 36)).toEqual([18, 19, 20, 21, 22]);
  });

  it("у края колоды сдвигается внутрь, но количество сохраняет", () => {
    expect(swipeCardIndices(0, 4, 36)).toEqual([0, 1, 2, 3]);
    expect(swipeCardIndices(35, 4, 36)).toEqual([32, 33, 34, 35]);
  });

  it("карт в колоде меньше, чем просят — берём всю колоду", () => {
    expect(swipeCardIndices(1, 8, 3)).toEqual([0, 1, 2]);
  });

  it("вырожденные входы безопасны", () => {
    expect(swipeCardIndices(0, 5, 0)).toEqual([]);
    expect(swipeCardIndices(0, 0, 36)).toEqual([]);
  });
});

describe("isSwipeDown", () => {
  it("вниз и вниз-по-диагонали — да", () => {
    expect(isSwipeDown(0, 1500)).toBe(true);
    expect(isSwipeDown(500, 1500)).toBe(true);
  });

  it("вверх, вбок и вялое движение — нет", () => {
    expect(isSwipeDown(0, -1500)).toBe(false);
    expect(isSwipeDown(1500, 0)).toBe(false);
    expect(isSwipeDown(1500, 300)).toBe(false); // почти горизонталь — это глиссандо
    expect(isSwipeDown(0, 50)).toBe(false);
  });
});
