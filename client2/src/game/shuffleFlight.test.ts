import { describe, it, expect } from "vitest";
import { shuffleFlight, bulgeDir } from "./shuffleFlight";
import { anim } from "./anim/config";

const H = 128;
const W = 90;
const f = anim.shuffle.flight;

describe("shuffleFlight", () => {
  it("карта с нулевой дельтой всё равно ЗАМЕТНО летит (пол по времени/подъёму/выносу)", () => {
    // Это суть фикса: раньше близкие карты «прыгали» на 12% высоты за 0.14с и только
    // менялись z-порядком — читалось как «карта превратилась в другую», а не переехала.
    const near = shuffleFlight(0, 0, 52, H, W);
    expect(near.dur).toBeGreaterThanOrEqual(f.durMin);
    expect(near.lift).toBeGreaterThanOrEqual(H * f.liftMin);
    expect(near.bulge).toBeGreaterThanOrEqual(W * f.bulgeMin);
  });

  it("дальняя карта — дольше и выше ближней", () => {
    const near = shuffleFlight(0, 0, 52, H, W);
    const far = shuffleFlight(1, 0, 52, H, W);
    expect(far.dur).toBeGreaterThan(near.dur);
    expect(far.lift).toBeGreaterThan(near.lift);
    expect(far.dur).toBeCloseTo(f.durMax, 5);
    expect(far.lift).toBeCloseTo(H * f.liftMax, 5);
  });

  it("боковой вынос НАОБОРОТ больше у близких карт — им нечем показать перелёт", () => {
    expect(shuffleFlight(0, 0, 52, H, W).bulge).toBeGreaterThan(shuffleFlight(1, 0, 52, H, W).bulge);
  });

  it("монотонность по дельте", () => {
    let prev = shuffleFlight(0, 0, 52, H, W);
    for (let k = 1; k <= 10; k++) {
      const cur = shuffleFlight(k / 10, 0, 52, H, W);
      expect(cur.dur).toBeGreaterThanOrEqual(prev.dur);
      expect(cur.lift).toBeGreaterThanOrEqual(prev.lift);
      expect(cur.bulge).toBeLessThanOrEqual(prev.bulge);
      prev = cur;
    }
  });

  it("каскад: старты размазаны по окну stagger, первая — сразу", () => {
    expect(shuffleFlight(0.5, 0, 52, H, W).delay).toBe(0);
    expect(shuffleFlight(0.5, 51, 52, H, W).delay).toBeCloseTo(f.stagger, 5);
    for (let i = 0; i < 52; i++) {
      const d = shuffleFlight(0.5, i, 52, H, W).delay;
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(f.stagger + 1e-9);
    }
  });

  it("одна карта в колоде — без деления на ноль", () => {
    const only = shuffleFlight(0, 0, 1, H, W);
    expect(only.delay).toBe(0);
    expect(Number.isFinite(only.dur)).toBe(true);
  });
});

describe("bulgeDir", () => {
  it("при заметном горизонтальном перелёте — в сторону движения", () => {
    expect(bulgeDir(W * 3, W, 0)).toBe(1);
    expect(bulgeDir(-W * 3, W, 0)).toBe(-1);
  });

  it("когда карта едет почти на месте (стопка) — чередуем стороны, как в риффле", () => {
    expect(bulgeDir(0, W, 0)).toBe(-1);
    expect(bulgeDir(0, W, 1)).toBe(1);
    expect(bulgeDir(2, W, 2)).toBe(-1);
  });
});
