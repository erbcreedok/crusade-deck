import { describe, it, expect } from "vitest";
import { easeOutQuad } from "./easing";

describe("easeOutQuad", () => {
  it("края: 0→0, 1→1", () => {
    expect(easeOutQuad(0)).toBeCloseTo(0, 5);
    expect(easeOutQuad(1)).toBeCloseTo(1, 5);
  });

  it("замедляется под конец: к середине времени пройдено больше половины пути", () => {
    expect(easeOutQuad(0.5)).toBeGreaterThan(0.5);
    // прирост в начале больше, чем в конце
    const early = easeOutQuad(0.1) - easeOutQuad(0);
    const late = easeOutQuad(1) - easeOutQuad(0.9);
    expect(early).toBeGreaterThan(late);
  });

  it("клампит выход за пределы [0,1]", () => {
    expect(easeOutQuad(-1)).toBe(0);
    expect(easeOutQuad(2)).toBe(1);
  });
});
