import { describe, expect, it } from "vitest";
import { clamp, clamp01, lerp, nearestIndexByX } from "./mathUtil";

describe("clamp", () => {
  it("зажимает в границы и пропускает середину", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
    expect(clamp(4, 0, 10)).toBe(4);
  });

  it("clamp01 — частный случай 0..1", () => {
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(0.25)).toBe(0.25);
  });
});

describe("lerp", () => {
  it("интерполирует по концам", () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  it("не клампит t — экстраполяция допустима", () => {
    expect(lerp(0, 10, 2)).toBe(20);
  });
});

describe("nearestIndexByX", () => {
  it("находит ближайшую карту по x", () => {
    expect(nearestIndexByX([0, 10, 20, 30], 21)).toBe(2);
    expect(nearestIndexByX([0, 10, 20, 30], -100)).toBe(0);
    expect(nearestIndexByX([0, 10, 20, 30], 100)).toBe(3);
  });

  it("на равном расстоянии берёт первого — порядок стабилен", () => {
    expect(nearestIndexByX([0, 10], 5)).toBe(0);
  });

  it("пустой список — 0 (вызывающий и так проверяет длину)", () => {
    expect(nearestIndexByX([], 5)).toBe(0);
  });
});
