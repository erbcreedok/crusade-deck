import { describe, it, expect } from "vitest";
import { fanCard } from "./fan";

const anchor = { x: 200, y: 300 };
const W = 344; // ширина сейф-зоны
const MAX = 30; // градусов
const WF = 0.9;

describe("fanCard", () => {
  it("крайние карты наклонены ровно на ±maxAngleDeg", () => {
    const n = 36;
    const first = fanCard(0, n, anchor, W, MAX, WF);
    const last = fanCard(n - 1, n, anchor, W, MAX, WF);
    expect((first.rot * 180) / Math.PI).toBeCloseTo(-MAX, 5);
    expect((last.rot * 180) / Math.PI).toBeCloseTo(+MAX, 5);
  });

  it("ни одна карта не наклонена круче maxAngleDeg", () => {
    const n = 36;
    const maxRad = (MAX * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      expect(Math.abs(fanCard(i, n, anchor, W, MAX, WF).rot)).toBeLessThanOrEqual(maxRad + 1e-9);
    }
  });

  it("центральная карта почти без наклона и у якоря", () => {
    const mid = fanCard(17, 35, anchor, W, MAX, WF); // индекс 17 из 35 → центр
    expect(mid.rot).toBeCloseTo(0, 5);
    expect(mid.x).toBeCloseTo(anchor.x, 5);
    expect(mid.y).toBeCloseTo(anchor.y, 5);
  });

  it("симметрия: края зеркальны по x, одинаковы по y (арка — края ниже центра)", () => {
    const n = 36;
    const first = fanCard(0, n, anchor, W, MAX, WF);
    const last = fanCard(n - 1, n, anchor, W, MAX, WF);
    expect(first.x - anchor.x).toBeCloseTo(-(last.x - anchor.x), 5);
    expect(first.y).toBeCloseTo(last.y, 5);
    expect(first.y).toBeGreaterThan(anchor.y); // края ниже центра (арка ∩)
  });

  it("веер занимает заданную долю ширины зоны", () => {
    const n = 36;
    const first = fanCard(0, n, anchor, W, MAX, WF);
    const last = fanCard(n - 1, n, anchor, W, MAX, WF);
    expect(last.x - first.x).toBeCloseTo(W * WF, 1);
  });

  it("одна карта — по центру без наклона", () => {
    const only = fanCard(0, 1, anchor, W, MAX, WF);
    expect(only.rot).toBe(0);
    expect(only.x).toBeCloseTo(anchor.x, 5);
  });
});
