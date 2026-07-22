import { describe, it, expect } from "vitest";
import { safeCapacity, safeStackAnchors, canFitAnother } from "./safeStacks";
import { computeLayout } from "./layout";

const layout = computeLayout(800, 900);
const zone = layout.safeZone;
const { cardH } = layout;

describe("safeCapacity — сколько колод влезает в сейф", () => {
  it("считается по высоте зоны, а не по фиксированной тройке", () => {
    const low = safeCapacity({ ...zone, h: cardH }, cardH);
    const tall = safeCapacity({ ...zone, h: cardH * 6 }, cardH);
    expect(tall).toBeGreaterThan(low);
  });

  it("в крошечный сейф всё равно влезает хотя бы одна", () => {
    expect(safeCapacity({ ...zone, h: 1 }, cardH)).toBe(1);
  });

  it("вместимость — целое положительное число", () => {
    const n = safeCapacity(zone, cardH);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
  });
});

describe("safeStackAnchors — колоды раскладываются сами", () => {
  it("сколько колод, столько мест", () => {
    for (const n of [1, 2, 3, 4]) {
      expect(safeStackAnchors(n, zone, cardH).length).toBe(n);
    }
  });

  it("одна колода стоит по центру сейфа", () => {
    const [a] = safeStackAnchors(1, zone, cardH);
    expect(a.x).toBeCloseTo(zone.cx, 5);
    expect(a.y).toBeCloseTo(zone.cy, 5);
  });

  it("несколько — столбиком сверху вниз, по центру по горизонтали", () => {
    const anchors = safeStackAnchors(3, zone, cardH);
    const ys = anchors.map((a) => a.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    for (const a of anchors) expect(a.x).toBeCloseTo(zone.cx, 5);
  });

  it("группа отцентрована в зоне: сверху и снизу поровну", () => {
    const anchors = safeStackAnchors(2, zone, cardH);
    const top = anchors[0].y - zone.cy;
    const bottom = anchors[anchors.length - 1].y - zone.cy;
    expect(top).toBeCloseTo(-bottom, 5);
  });

  it("шаг между колодами одинаковый — раскладка ровная", () => {
    const anchors = safeStackAnchors(4, zone, cardH);
    const steps = anchors.slice(1).map((a, i) => a.y - anchors[i].y);
    for (const s of steps) expect(s).toBeCloseTo(steps[0], 5);
  });

  it("ничего не лежит — мест тоже нет", () => {
    expect(safeStackAnchors(0, zone, cardH)).toEqual([]);
  });

  it("больше вместимости — места всё равно считаются (решение о «не влезет» принимает вызывающий)", () => {
    const cap = safeCapacity(zone, cardH);
    expect(safeStackAnchors(cap + 2, zone, cardH).length).toBe(cap + 2);
  });
});

describe("canFitAnother — влезет ли ещё одна колода", () => {
  const cap = safeCapacity(zone, cardH);

  it("в пустой сейф — конечно, влезет", () => {
    expect(canFitAnother(0, zone, cardH)).toBe(true);
  });

  it("пока мест меньше вместимости — влезает", () => {
    expect(canFitAnother(cap - 1, zone, cardH)).toBe(true);
  });

  it("сейф полон — не влезет", () => {
    expect(canFitAnother(cap, zone, cardH)).toBe(false);
    expect(canFitAnother(cap + 3, zone, cardH)).toBe(false);
  });

  it("отрицательное число трактуем как пустой сейф, а не как ошибку", () => {
    expect(canFitAnother(-2, zone, cardH)).toBe(true);
  });
});
