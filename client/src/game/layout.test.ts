import { describe, it, expect } from "vitest";
import { computeLayout } from "./layout";

function inside(e: { cx: number; cy: number; rx: number; ry: number }, w: number, h: number) {
  return e.cx - e.rx >= 0 && e.cx + e.rx <= w && e.cy - e.ry >= 0 && e.cy + e.ry <= h;
}

describe("computeLayout", () => {
  it("овал стола вписан в канвас", () => {
    const l = computeLayout(800, 600);
    expect(inside(l.table, 800, 600)).toBe(true);
  });

  it("центральная зона лежит внутри стола", () => {
    const l = computeLayout(800, 600);
    expect(l.center.rx).toBeLessThan(l.table.rx);
    expect(l.center.ry).toBeLessThan(l.table.ry);
    expect(l.center.cx).toBeCloseTo(l.table.cx, 5);
  });

  it("якорь колоды примерно в центре стола", () => {
    const l = computeLayout(800, 600);
    expect(l.deckAnchor.x).toBeCloseTo(400, 0);
    expect(Math.abs(l.deckAnchor.y - 300)).toBeLessThan(l.table.ry * 0.5);
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

  it("устойчив к вырожденным размерам (0/крошечный) — без NaN и отрицательных радиусов", () => {
    const l = computeLayout(0, 0);
    expect(Number.isFinite(l.table.rx)).toBe(true);
    expect(l.table.rx).toBeGreaterThanOrEqual(0);
    expect(l.cardH).toBeGreaterThan(0);
  });
});
