import { describe, it, expect } from "vitest";
import { fanShadowIndices, liftOf, shadowSilhouette } from "./shadowPass";

const cardW = 60;
/** Веер: карты идут слева направо с заданным шагом. */
const fan = (count: number, step: number) => Array.from({ length: count }, (_, i) => i * step);

describe("fanShadowIndices", () => {
  it("просторный веер — тень под каждой картой", () => {
    const xs = fan(5, cardW);
    expect(fanShadowIndices({ xs, cardW })).toEqual([0, 1, 2, 3, 4]);
  });

  it("тесный веер — тени через одну-две, иначе они сливаются в полосу", () => {
    const xs = fan(30, 6); // карты почти друг на друге
    const idx = fanShadowIndices({ xs, cardW });
    expect(idx.length).toBeLessThan(xs.length / 2);
    expect(idx.length).toBeGreaterThan(1);
  });

  it("верхняя карта отбрасывает тень всегда — она лежит поверх всех", () => {
    const xs = fan(30, 6);
    expect(fanShadowIndices({ xs, cardW })).toContain(xs.length - 1);
  });

  it("выбранные тени стоят не ближе трети карты друг к другу", () => {
    const xs = fan(40, 5);
    const idx = fanShadowIndices({ xs, cardW });
    // Верхняя карта — исключение: её берём всегда, даже если она рядом с предыдущей.
    for (let k = 1; k < idx.length - 1; k++) {
      expect(Math.abs(xs[idx[k]!]! - xs[idx[k - 1]!]!)).toBeGreaterThanOrEqual(cardW * 0.33);
    }
  });

  it("карту, которую тащат, в вееере не теним — у неё своя тень", () => {
    const xs = fan(5, cardW);
    expect(fanShadowIndices({ xs, cardW, skip: 2 })).not.toContain(2);
  });

  it("пустой веер — теней нет", () => {
    expect(fanShadowIndices({ xs: [], cardW })).toEqual([]);
  });
});

describe("liftOf", () => {
  it("эталонная карта лежит на столе — подъёма нет", () => {
    expect(liftOf(1)).toBe(0);
    expect(liftOf(0.9)).toBe(0);
  });

  it("чем крупнее карта, тем выше она над столом", () => {
    expect(liftOf(1.45)).toBeGreaterThan(liftOf(1.2));
  });
});

describe("shadowSilhouette", () => {
  const box = { x: 100, y: 200, w: 40, h: 60, rot: 0 };

  it("восьмиугольник: прямоугольник со срезанными углами", () => {
    const pts = shadowSilhouette(box);
    expect(pts).toHaveLength(16); // 8 точек по две координаты
  });

  it("силуэт не вылезает за габарит карты", () => {
    const pts = shadowSilhouette(box);
    for (let i = 0; i < pts.length; i += 2) {
      expect(Math.abs(pts[i]! - box.x)).toBeLessThanOrEqual(box.w / 2 + 1e-9);
      expect(Math.abs(pts[i + 1]! - box.y)).toBeLessThanOrEqual(box.h / 2 + 1e-9);
    }
  });

  it("углы действительно срезаны — иначе это просто прямоугольник", () => {
    const pts = shadowSilhouette(box);
    const corners = [];
    for (let i = 0; i < pts.length; i += 2) {
      const dx = Math.abs(pts[i]! - box.x);
      const dy = Math.abs(pts[i + 1]! - box.y);
      if (dx > box.w / 2 - 1e-9 && dy > box.h / 2 - 1e-9) corners.push(i);
    }
    expect(corners).toHaveLength(0);
  });

  it("поворот вращает силуэт вокруг центра карты", () => {
    const straight = shadowSilhouette(box);
    const turned = shadowSilhouette({ ...box, rot: Math.PI / 2 });
    expect(turned).not.toEqual(straight);
    // Центр на месте: сумма координат вокруг него симметрична.
    const cx = turned.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / 8;
    expect(cx).toBeCloseTo(box.x, 6);
  });

  it("вырожденная карта не ломает силуэт", () => {
    expect(shadowSilhouette({ x: 0, y: 0, w: 0, h: 0, rot: 0 })).toHaveLength(16);
  });
});
