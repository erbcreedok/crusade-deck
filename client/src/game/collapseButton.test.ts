import { describe, it, expect } from "vitest";
import { fitCollapseButton } from "./collapseButton";

const base = { cx: 100, bottomY: 300, margin: 6, minR: 10, maxR: 40 };

// Ровная «нижняя кромка карт» на высоте y.
const edge = (y: number) => Array.from({ length: 21 }, (_, i) => ({ x: 40 + i * 6, y }));

describe("fitCollapseButton", () => {
  it("без препятствий берёт максимальный радиус и прижимается ко дну", () => {
    const b = fitCollapseButton({ ...base, obstacles: [] });
    expect(b.r).toBe(base.maxR);
    expect(b.y).toBe(base.bottomY - base.margin - base.maxR);
    expect(b.x).toBe(base.cx);
  });

  it("тесный карман: круг сжимается и КАСАЕТСЯ карт, но не заходит на них", () => {
    const b = fitCollapseButton({ ...base, obstacles: edge(250) });
    const gap = Math.hypot(0, b.y - 250); // ближайшая точка кромки прямо над центром
    expect(b.r).toBeLessThan(base.maxR);
    expect(gap).toBeGreaterThanOrEqual(b.r - 0.5); // не залезли
    expect(gap).toBeLessThanOrEqual(b.r + 1.5); // и не оставили лишнего — именно касание
  });

  it("чем ниже висят карты, тем меньше кнопка", () => {
    const high = fitCollapseButton({ ...base, obstacles: edge(230) });
    const low = fitCollapseButton({ ...base, obstacles: edge(270) });
    expect(low.r).toBeLessThan(high.r);
  });

  it("совсем нет места — радиус не падает ниже минимума", () => {
    const b = fitCollapseButton({ ...base, obstacles: edge(299) });
    expect(b.r).toBeGreaterThanOrEqual(base.minR);
  });

  it("кнопка всегда стоит над дном зоны с заданным отступом", () => {
    for (const y of [200, 240, 280]) {
      const b = fitCollapseButton({ ...base, obstacles: edge(y) });
      expect(b.y + b.r).toBeCloseTo(base.bottomY - base.margin, 6);
    }
  });

  it("учитывает не только точку над центром, но и косые края кармана", () => {
    // Карты уходят вниз по бокам — круг обязан сжаться сильнее, чем по вертикали.
    const slanted = [
      { x: 100, y: 240 },
      { x: 70, y: 262 },
      { x: 130, y: 262 },
    ];
    const flat = fitCollapseButton({ ...base, obstacles: [{ x: 100, y: 240 }] });
    const sloped = fitCollapseButton({ ...base, obstacles: slanted });
    expect(sloped.r).toBeLessThanOrEqual(flat.r);
  });
});
