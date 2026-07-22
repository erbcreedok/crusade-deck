import { describe, it, expect } from "vitest";
import { cardBottomY, collapseAnchorBottom, fitCollapseButton } from "./collapseButton";

const base = { cx: 100, minR: 10, maxR: 40 };

// Ровная «нижняя кромка карт» на высоте y.
const edge = (y: number) => Array.from({ length: 21 }, (_, i) => ({ x: 40 + i * 6, y }));

describe("cardBottomY", () => {
  it("берёт самую нижнюю точку кромки", () => {
    expect(cardBottomY([{ x: 0, y: 10 }, { x: 1, y: 40 }, { x: 2, y: 25 }], 0)).toBe(40);
  });

  it("без точек — fallback", () => {
    expect(cardBottomY([], 123)).toBe(123);
  });
});

describe("collapseAnchorBottom", () => {
  it("фиксированный офсет от верхней кромки — всегда +cardH", () => {
    expect(collapseAnchorBottom(100, 80)).toBe(180);
    expect(collapseAnchorBottom(100, 80)).toBe(collapseAnchorBottom(100, 80));
  });
});

describe("fitCollapseButton", () => {
  it("висит под кромкой: верх хит-радиуса касается карт, не дно бокса", () => {
    const bottom = 200;
    const b = fitCollapseButton({ ...base, cardBottomY: bottom, obstacles: edge(bottom) });
    expect(b.r).toBe(base.maxR);
    expect(b.y).toBe(bottom + base.maxR); // центр ниже кромки на r
    expect(b.y - b.r).toBeCloseTo(bottom, 6); // верх хита = кромка
    expect(b.x).toBe(base.cx);
  });

  it("не зависит от «дна зоны» — только от кромки карт", () => {
    const a = fitCollapseButton({ ...base, cardBottomY: 180, obstacles: edge(180) });
    const b = fitCollapseButton({ ...base, cardBottomY: 260, obstacles: edge(260) });
    expect(a.y - a.r).toBeCloseTo(180, 6);
    expect(b.y - b.r).toBeCloseTo(260, 6);
    expect(b.y - a.y).toBeCloseTo(80, 6);
  });

  it("косые края: хит-круг не врезается в точки кромки", () => {
    const slanted = [
      { x: 100, y: 200 },
      { x: 70, y: 222 },
      { x: 130, y: 222 },
    ];
    const bottom = cardBottomY(slanted, 200);
    const sloped = fitCollapseButton({ ...base, cardBottomY: bottom, obstacles: slanted });
    expect(minGap(sloped, slanted)).toBeGreaterThanOrEqual(sloped.r - 0.5);
    // верх хита на уровне самой нижней точки кромки
    expect(sloped.y - sloped.r).toBeCloseTo(bottom, 6);
  });

  it("без препятствий — максимальный радиус под заданной кромкой", () => {
    const b = fitCollapseButton({ ...base, cardBottomY: 150, obstacles: [] });
    expect(b.r).toBe(base.maxR);
    expect(b.y).toBe(150 + base.maxR);
  });
});

function minGap(b: { x: number; y: number; r: number }, pts: { x: number; y: number }[]): number {
  let best = Infinity;
  for (const p of pts) best = Math.min(best, Math.hypot(p.x - b.x, p.y - b.y));
  return best;
}
