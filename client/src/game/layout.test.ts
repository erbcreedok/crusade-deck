import { describe, it, expect } from "vitest";
import { computeLayout, type RoundedRect } from "./layout";

function inside(r: RoundedRect, w: number, h: number) {
  return r.cx - r.w / 2 >= -1 && r.cx + r.w / 2 <= w + 1 && r.cy - r.h / 2 >= -1 && r.cy + r.h / 2 <= h + 1;
}

describe("computeLayout", () => {
  it("зоны центра и сейфа занимают ≥80% ширины", () => {
    const l = computeLayout(800, 600);
    expect(l.centerZone.w).toBeGreaterThanOrEqual(800 * 0.8);
    expect(l.safeZone.w).toBeGreaterThanOrEqual(800 * 0.8);
  });

  it("все зоны вписаны в канвас", () => {
    const l = computeLayout(800, 600);
    expect(inside(l.centerZone, 800, 600)).toBe(true);
    expect(inside(l.safeZone, 800, 600)).toBe(true);
    expect(inside(l.handZone, 800, 600)).toBe(true);
  });

  it("порядок снизу вверх: рука → сейф → центр, полосы не наслаиваются", () => {
    const l = computeLayout(800, 600);
    expect(l.centerZone.cy).toBeLessThan(l.safeZone.cy);
    expect(l.safeZone.cy).toBeLessThan(l.handZone.cy);
    // центр целиком выше сейфа, сейф целиком выше руки
    expect(l.centerZone.cy + l.centerZone.h / 2).toBeLessThan(l.safeZone.cy - l.safeZone.h / 2);
    expect(l.safeZone.cy + l.safeZone.h / 2).toBeLessThan(l.handZone.cy - l.handZone.h / 2);
  });

  it("якоря колоды совпадают с центрами своих зон", () => {
    const l = computeLayout(800, 600);
    expect(l.deckAnchor).toEqual({ x: l.centerZone.cx, y: l.centerZone.cy });
    expect(l.safeAnchor).toEqual({ x: l.safeZone.cx, y: l.safeZone.cy });
  });

  it("карта имеет пропорции игральной (узкая по ширине)", () => {
    const l = computeLayout(800, 600);
    expect(l.cardW / l.cardH).toBeCloseTo(0.7, 1);
  });

  it("масштабируется: канвас крупнее → карта крупнее (до клампа)", () => {
    const small = computeLayout(320, 480);
    const big = computeLayout(1200, 900);
    expect(big.cardH).toBeGreaterThan(small.cardH);
  });

  it("размер карты ограничен сверху на огромном канвасе", () => {
    const huge = computeLayout(4000, 3000);
    expect(huge.cardH).toBeLessThanOrEqual(140);
  });

  it("устойчив к вырожденным размерам (0/крошечный) — без NaN и отрицательных размеров", () => {
    const l = computeLayout(0, 0);
    expect(Number.isFinite(l.centerZone.w)).toBe(true);
    expect(l.centerZone.w).toBeGreaterThanOrEqual(0);
    expect(l.cardH).toBeGreaterThan(0);
  });
});
