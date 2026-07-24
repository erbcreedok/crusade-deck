import { describe, it, expect } from "vitest";
import { cardFlightPose, clamp01, lerp } from "./cardFlight";

describe("cardFlightPose", () => {
  const from = { x: 0, y: 0, rot: 0 };
  const to = { x: 100, y: 200, rot: 0.4 };

  it("старт и финиш на концах дуги", () => {
    const a = cardFlightPose(0, from, to, 50);
    expect(a.x).toBeCloseTo(0, 5);
    expect(a.y).toBeCloseTo(0, 5);
    const b = cardFlightPose(1, from, to, 50);
    expect(b.x).toBeCloseTo(100, 5);
    expect(b.y).toBeCloseTo(200, 5);
    expect(b.rot).toBeCloseTo(0.4, 5);
  });

  it("в середине есть подъём дуги", () => {
    const mid = cardFlightPose(0.5, from, to, 80);
    const straightY = lerp(0, 200, 0.5); // easeOutQuad(0.5)=0.75 → не 100
    // Дуга вычитает sin — y меньше «прямой» интерполяции с тем же u.
    expect(mid.y).toBeLessThan(straightY);
  });
});

describe("clamp01 / lerp", () => {
  it("клампит и мешает", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(lerp(10, 20, 0.5)).toBe(15);
  });
});
