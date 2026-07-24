import { describe, it, expect } from "vitest";
import { stepSpring, isSettled, type SpringState } from "./spring";

const cfg = { stiffness: 120, damping: 14 };

function run(from: number, target: number, steps: number, dt = 1 / 60, snap = false) {
  let s: SpringState = { pos: from, vel: 0 };
  const trace: number[] = [];
  for (let i = 0; i < steps; i++) {
    s = stepSpring(s, target, cfg, dt, snap);
    trace.push(s.pos);
  }
  return { state: s, trace };
}

describe("stepSpring", () => {
  it("движется к цели и в итоге сходится к ней", () => {
    const { state } = run(0, 100, 300);
    expect(state.pos).toBeCloseTo(100, 1);
    expect(Math.abs(state.vel)).toBeLessThan(0.1);
  });

  it("оседает: isSettled становится true", () => {
    const { state } = run(0, 100, 400);
    expect(isSettled(state, 100)).toBe(true);
  });

  it("недодемпфирован — даёт лёгкий овершут (baunce/juice)", () => {
    // damping 14 < критического 2*sqrt(120)≈21.9 → должен разок перелететь цель
    const { trace } = run(0, 100, 300);
    expect(Math.max(...trace)).toBeGreaterThan(100);
  });

  it("snap=true — мгновенно в цель, скорость 0", () => {
    const s = stepSpring({ pos: 3, vel: 999 }, 100, cfg, 1 / 60, true);
    expect(s.pos).toBe(100);
    expect(s.vel).toBe(0);
  });

  it("dt<=0 — состояние не меняется (нет NaN/скачков)", () => {
    const s = stepSpring({ pos: 42, vel: 7 }, 100, cfg, 0);
    expect(s.pos).toBe(42);
    expect(s.vel).toBe(7);
  });

  it("устойчив при большом dt (не разлетается в NaN/Infinity)", () => {
    const { state } = run(0, 100, 50, 1); // намеренно грубый dt
    expect(Number.isFinite(state.pos)).toBe(true);
  });
});

describe("isSettled", () => {
  it("false пока далеко от цели", () => {
    expect(isSettled({ pos: 0, vel: 0 }, 100)).toBe(false);
  });
  it("false пока быстро движется", () => {
    expect(isSettled({ pos: 100, vel: 50 }, 100)).toBe(false);
  });
});
