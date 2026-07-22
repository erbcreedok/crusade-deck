import { describe, it, expect } from "vitest";
import { SpinChoreography } from "./spin";
import { anim } from "../anim/config";

const anchor = { x: 400, y: 300 };
const TWO_PI = Math.PI * 2;

function make(count = 36, seed = 1) {
  return new SpinChoreography({ count, anchor, seed });
}

describe("SpinChoreography (умеренная растасовка)", () => {
  it("короткая: длительность = spin.dur", () => {
    expect(make().durationSec).toBeCloseTo(anim.shuffle.spin.dur, 5);
  });

  it("выдаёт цель на каждую карту", () => {
    expect(make(36).sample(0.1)).toHaveLength(36);
    expect(make(0).sample(0.1)).toHaveLength(0);
  });

  it("колода не разлетается: все карты всё время у якоря по X (единый блок)", () => {
    const c = make(20);
    for (const t of [0, 0.1, 0.3, c.durationSec]) {
      for (const card of c.sample(t)) expect(card.x).toBeCloseTo(anchor.x, 5);
    }
  });

  it("крутится по часовой: угол растёт со временем", () => {
    const c = make(10);
    const r0 = c.sample(0)[0].rot ?? 0;
    const rMid = c.sample(c.durationSec / 2)[0].rot ?? 0;
    const rEnd = c.sample(c.durationSec)[0].rot ?? 0;
    expect(rMid).toBeGreaterThan(r0);
    expect(rEnd).toBeGreaterThan(rMid);
  });

  it("делает ровно turns полных оборотов (в конце угол = покой + 2π·turns)", () => {
    const c = make(10);
    const r0 = c.sample(0)[0].rot ?? 0;
    const rEnd = c.sample(c.durationSec)[0].rot ?? 0;
    expect(rEnd - r0).toBeCloseTo(TWO_PI * anim.shuffle.spin.turns, 5);
  });

  it("startOrder — натуральный порядок без чересполосицы", () => {
    expect(make(5).startOrder()).toEqual([0, 1, 2, 3, 4]);
  });

  it("масштаб держится ~1 (без пульса)", () => {
    const c = make(8);
    for (const card of c.sample(c.durationSec / 2)) expect(card.scale ?? 1).toBeCloseTo(1, 5);
  });

  it("детерминизм по seed и отсутствие NaN за пределами", () => {
    expect(make(12, 3).sample(0.05)).toEqual(make(12, 3).sample(0.05));
    for (const card of make(5).sample(999)) {
      expect(Number.isFinite(card.x ?? 0)).toBe(true);
      expect(Number.isFinite(card.rot ?? 0)).toBe(true);
    }
  });
});
