import { describe, it, expect } from "vitest";
import { collapseRevealPose } from "./collapseReveal";

describe("collapseRevealPose", () => {
  it("в нуле — ниже цели и прозрачна", () => {
    const p = collapseRevealPose(0, 200, 40);
    expect(p.y).toBe(240);
    expect(p.alpha).toBe(0);
  });

  it("в единице — на месте и непрозрачна", () => {
    const p = collapseRevealPose(1, 200, 40);
    expect(p.y).toBe(200);
    expect(p.alpha).toBe(1);
  });

  it("посередине — уже поднялась больше чем наполовину (easeOut)", () => {
    const p = collapseRevealPose(0.5, 200, 40);
    expect(p.y).toBeLessThan(220); // дальше середины пути вверх
    expect(p.alpha).toBeGreaterThan(0.5);
  });
});
