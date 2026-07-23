import { describe, it, expect } from "vitest";
import { fanShadowIndices, liftOf } from "./shadowPass";

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
