import { describe, it, expect } from "vitest";
import { classifyDeckSwipe, isSwipeDown, flipFactor, flipShowsOther, flipTransform, stretchOffset } from "./flip";

describe("classifyDeckSwipe", () => {
  const dir = (vx: number, vy: number) => classifyDeckSwipe(vx, vy);

  it("вниз, вбок и диагонали ВНИЗ — переворот", () => {
    expect(dir(0, 1500).action).toBe("flip");
    expect(dir(1500, 0).action).toBe("flip");
    expect(dir(-1500, 0).action).toBe("flip");
    expect(dir(1200, 1200).action).toBe("flip");
    expect(dir(-1200, 1200).action).toBe("flip");
  });

  it("ЛЮБОЙ свайп с уходом вверх — только тянучка, включая диагонали", () => {
    expect(dir(0, -1500).action).toBe("stretch");
    expect(dir(300, -1500).action).toBe("stretch");
    expect(dir(1500, -900).action).toBe("stretch"); // пологая диагональ вверх
    expect(dir(-1500, -900).action).toBe("stretch");
    expect(dir(1200, -1200).action).toBe("stretch"); // ровно 45° вверх
  });

  it("лёгкий увод вверх у горизонтального свайпа не мешает перевороту", () => {
    expect(dir(1500, -60).action).toBe("flip"); // ~2° — это дрожание руки, а не жест вверх
  });

  it("угол эффекта — это угол самого свайпа (анимация идёт по направлению)", () => {
    expect(dir(0, 1000).angle).toBeCloseTo(Math.PI / 2, 6);
    expect(dir(1000, 0).angle).toBeCloseTo(0, 6);
    expect(dir(1000, 1000).angle).toBeCloseTo(Math.PI / 4, 6);
  });

  it("вялое движение жестом не считается", () => {
    expect(dir(10, 10).action).toBe("none");
    expect(dir(0, 0).action).toBe("none");
  });
});

describe("flipFactor / flipShowsOther", () => {
  it("карта схлопывается в ребро на середине и раскрывается обратно", () => {
    expect(flipFactor(0)).toBeCloseTo(1, 6);
    expect(Math.abs(flipFactor(0.5))).toBeCloseTo(0, 6);
    expect(flipFactor(1)).toBeCloseTo(-1, 6);
  });

  it("другая сторона показывается ровно на середине — в момент ребра, а не раньше", () => {
    expect(flipShowsOther(0.49)).toBe(false);
    expect(flipShowsOther(0.5)).toBe(true);
    expect(flipShowsOther(1)).toBe(true);
  });
});

describe("flipTransform", () => {
  const base = { cx: 100, cy: 50, rot: 0, scale: 2 };

  it("в начале переворота — обычный масштаб без искажений", () => {
    const m = flipTransform(base.cx, base.cy, base.rot, base.scale, Math.PI / 2, 1);
    expect(m.a).toBeCloseTo(2, 6);
    expect(m.d).toBeCloseTo(2, 6);
    expect(m.b).toBeCloseTo(0, 6);
    expect(m.c).toBeCloseTo(0, 6);
    expect(m.tx).toBe(100);
    expect(m.ty).toBe(50);
  });

  it("на ребре площадь вырождается в ноль (карта видна с торца)", () => {
    const m = flipTransform(base.cx, base.cy, base.rot, base.scale, Math.PI / 2, 0);
    expect(m.a * m.d - m.b * m.c).toBeCloseTo(0, 6);
  });

  it("ось свайпа не сжимается, поперёк оси — сжимается", () => {
    // свайп вниз (ось x): ширина сохраняется, высота схлопывается
    const m = flipTransform(0, 0, 0, 1, Math.PI / 2, 0);
    expect(Math.abs(m.a)).toBeCloseTo(1, 6); // x-масштаб цел
    expect(Math.abs(m.d)).toBeCloseTo(0, 6); // y схлопнут
    // свайп вбок (ось y): наоборот
    const side = flipTransform(0, 0, 0, 1, 0, 0);
    expect(Math.abs(side.a)).toBeCloseTo(0, 6);
    expect(Math.abs(side.d)).toBeCloseTo(1, 6);
  });

  it("к концу переворота карта зеркальна — определитель отрицательный", () => {
    const m = flipTransform(0, 0, 0, 1, Math.PI / 2, -1);
    expect(m.a * m.d - m.b * m.c).toBeLessThan(0);
  });

  it("собственный поворот карты сохраняется (веер не «выпрямляется»)", () => {
    const m = flipTransform(0, 0, Math.PI / 6, 1, Math.PI / 2, 1);
    expect(Math.atan2(m.b, m.a)).toBeCloseTo(Math.PI / 6, 6);
  });
});

describe("stretchOffset", () => {
  it("тянется в сторону жеста и возвращается — как резина", () => {
    expect(stretchOffset(0, 0, 100)).toEqual({ dx: 0, dy: 0 });
    const mid = stretchOffset(0.3, 0, 100);
    expect(mid.dx).toBeGreaterThan(0);
    expect(Math.hypot(...Object.values(stretchOffset(1, 0, 100)))).toBeCloseTo(0, 6);
  });

  it("направление совпадает с углом жеста", () => {
    const up = stretchOffset(0.3, -Math.PI / 2, 100);
    expect(up.dy).toBeLessThan(0);
    expect(up.dx).toBeCloseTo(0, 6);
  });

  it("на обратном ходе проскакивает через ноль — резина «отдаёт»", () => {
    const back = stretchOffset(0.8, 0, 100);
    expect(back.dx).toBeLessThan(0);
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
