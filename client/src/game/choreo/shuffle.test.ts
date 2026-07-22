import { describe, it, expect } from "vitest";
import { ShuffleChoreography } from "./shuffle";
import { anim } from "../anim/config";

const anchor = { x: 400, y: 300 };

function make(count = 52, seed = 1) {
  return new ShuffleChoreography({ count, anchor, seed });
}

describe("ShuffleChoreography", () => {
  it("длительность = сумма фаз из конфига", () => {
    const c = make();
    expect(c.durationSec).toBeCloseTo(
      anim.shuffle.lift.dur + anim.shuffle.riffle.dur + anim.shuffle.settle.dur,
      5,
    );
  });

  it("выдаёт цель на каждую карту", () => {
    expect(make(52).sample(0.1)).toHaveLength(52);
    expect(make(0).sample(0.1)).toHaveLength(0);
  });

  it("в t=0 карты в покое: по X у якоря, стопка по Y", () => {
    const c = make(10);
    const s = c.sample(0);
    for (const t of s) expect(t.x).toBeCloseTo(anchor.x, 5);
    // стопка: соседние карты смещены по Y на stackDy
    expect(Math.abs((s[1].y ?? 0) - (s[0].y ?? 0))).toBeCloseTo(anim.deck.stackDy, 5);
  });

  it("в конце — снова ровная стопка (все по X у якоря, масштаб ~1)", () => {
    const c = make(20);
    const s = c.sample(c.durationSec);
    for (const t of s) {
      expect(t.x).toBeCloseTo(anchor.x, 3);
      expect(t.scale ?? 1).toBeCloseTo(1, 2);
    }
  });

  it("в середине риффла стопка разъезжается на две половины (лево/право)", () => {
    const c = make(20);
    const tMid = anim.shuffle.lift.dur + anim.shuffle.riffle.dur / 2;
    const s = c.sample(tMid);
    const left = s.slice(0, 10);
    const right = s.slice(10);
    // левая половина ушла влево от якоря, правая — вправо
    expect(Math.max(...left.map((t) => t.x ?? 0))).toBeLessThan(anchor.x);
    expect(Math.min(...right.map((t) => t.x ?? 0))).toBeGreaterThan(anchor.x);
    // разлёт заметный
    expect(anchor.x - (left[0].x ?? 0)).toBeGreaterThan(anim.shuffle.riffle.spread * 0.5);
  });

  it("в риффле стопка приподнята над покоем", () => {
    const c = make(10);
    const restY0 = c.sample(0)[0].y ?? 0;
    const tMid = anim.shuffle.lift.dur + anim.shuffle.riffle.dur / 2;
    const liftedY0 = c.sample(tMid)[0].y ?? 0;
    expect(liftedY0).toBeLessThan(restY0); // меньше Y = выше на экране
  });

  it("детерминизм: одинаковый seed → идентичный sample", () => {
    const a = make(15, 7).sample(0.05);
    const b = make(15, 7).sample(0.05);
    expect(a).toEqual(b);
  });

  it("разный seed → разный разброс углов в покое", () => {
    const a = make(15, 1).sample(0).map((t) => t.rot);
    const b = make(15, 2).sample(0).map((t) => t.rot);
    expect(a).not.toEqual(b);
  });

  it("done() истинно только после конца", () => {
    const c = make();
    expect(c.done(c.durationSec - 0.01)).toBe(false);
    expect(c.done(c.durationSec + 0.01)).toBe(true);
  });

  it("sample за пределами времени не даёт NaN", () => {
    const c = make(5);
    for (const t of c.sample(999)) {
      expect(Number.isFinite(t.x ?? 0)).toBe(true);
      expect(Number.isFinite(t.y ?? 0)).toBe(true);
    }
  });
});
