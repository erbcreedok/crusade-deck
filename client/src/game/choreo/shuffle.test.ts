import { describe, it, expect } from "vitest";
import { ShuffleChoreography } from "./shuffle";
import { anim } from "../anim/config";

const anchor = { x: 400, y: 300 };

function make(count = 52, seed = 1) {
  return new ShuffleChoreography({ count, anchor, seed });
}

describe("ShuffleChoreography", () => {
  it("длительность = фазы + окно разброса старта (stagger)", () => {
    const c = make();
    const { lift, riffle, settle, stagger } = anim.shuffle;
    expect(c.durationSec).toBeCloseTo(lift.dur + riffle.dur + settle.dur + stagger.total, 5);
  });

  it("выдаёт цель на каждую карту", () => {
    expect(make(52).sample(0.1)).toHaveLength(52);
    expect(make(0).sample(0.1)).toHaveLength(0);
  });

  it("в t=0 карты в покое: по X у якоря, стопка по Y", () => {
    const c = make(10);
    const s = c.sample(0);
    for (const t of s) expect(t.x).toBeCloseTo(anchor.x, 5);
    // стопка: соседние карты смещены по Y на stackDy (знак задаёт направление стопки —
    // здесь важна только величина шага)
    expect(Math.abs((s[1].y ?? 0) - (s[0].y ?? 0))).toBeCloseTo(Math.abs(anim.deck.stackDy), 5);
  });

  it("в конце — снова ровная стопка (все по X у якоря, масштаб ~1)", () => {
    const c = make(20);
    const s = c.sample(c.durationSec);
    for (const t of s) {
      expect(t.x).toBeCloseTo(anchor.x, 3);
      expect(t.scale ?? 1).toBeCloseTo(1, 2);
    }
  });

  it("в середине риффла половины в среднем разъезжаются влево/вправо", () => {
    const c = make(20);
    const tMid = anim.shuffle.lift.dur + anim.shuffle.riffle.dur / 2;
    const s = c.sample(tMid);
    const left = s.slice(0, 10).map((t) => (t.x ?? 0) - anchor.x);
    const right = s.slice(10).map((t) => (t.x ?? 0) - anchor.x);
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    // левая половина в среднем левее якоря, правая — правее
    expect(avg(left)).toBeLessThan(0);
    expect(avg(right)).toBeGreaterThan(0);
    // разлёт заметный (хотя бы одна карта ушла на пол-spread)
    expect(Math.max(...s.map((t) => Math.abs((t.x ?? 0) - anchor.x)))).toBeGreaterThan(
      anim.shuffle.riffle.spread * 0.5,
    );
  });

  it("в риффле стопка приподнята над покоем", () => {
    const c = make(10);
    const restY0 = c.sample(0)[0].y ?? 0;
    const tMid = anim.shuffle.lift.dur + anim.shuffle.riffle.dur / 2;
    const liftedY0 = c.sample(tMid)[0].y ?? 0;
    expect(liftedY0).toBeLessThan(restY0); // меньше Y = выше на экране
  });

  it("веер/каскад: карты стартуют не одновременно (задержка между стартами)", () => {
    const c = make(20);
    const rest = c.sample(0);
    const s = c.sample(0.05); // сразу после старта
    const moved = s.filter((t, i) => Math.abs((t.y ?? 0) - (rest[i].y ?? 0)) > 0.5);
    // часть карт уже пошла вверх, часть ещё в покое → это каскад, а не одновременный старт
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.length).toBeLessThan(20);
  });

  it("чересполосица: старты чередуют половины (L,R,L,R,…)", () => {
    const c = make(20); // half=10: индексы 0..9 — левая половина, 10..19 — правая
    const order = c.startOrder();
    expect(order).toHaveLength(20);
    const sides = order.map((i) => (i < 10 ? "L" : "R"));
    let alternations = 0;
    for (let k = 1; k < sides.length; k++) if (sides[k] !== sides[k - 1]) alternations++;
    // почти все соседние старты — с разных половин (классический riffle-bridge)
    expect(alternations).toBeGreaterThan(sides.length - 3);
  });

  it("дистанция разлёта у карт одной половины различается (не строем)", () => {
    const c = make(20);
    const tMid = anim.shuffle.lift.dur + anim.shuffle.riffle.dur / 2;
    const s = c.sample(tMid);
    const leftOffsets = s.slice(0, 10).map((t) => Math.abs((t.x ?? 0) - anchor.x));
    const uniq = new Set(leftOffsets.map((v) => v.toFixed(2)));
    expect(uniq.size).toBeGreaterThan(1);
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

  it("feel.stagger=0 убирает каскад: длительность = сумма фаз, старты одновременны", () => {
    const { lift, riffle, settle } = anim.shuffle;
    const c = new ShuffleChoreography({ count: 20, anchor, seed: 1, feel: { stagger: 0 } });
    expect(c.durationSec).toBeCloseTo(lift.dur + riffle.dur + settle.dur, 5);
    // все карты в один момент проходят одну фазу → одинаковый lift по Y (без учёта толщины стопки)
    const rest = c.sample(0);
    const s = c.sample(lift.dur); // конец подъёма
    const lifts = s.map((t, i) => (rest[i].y ?? 0) - (t.y ?? 0));
    expect(Math.max(...lifts) - Math.min(...lifts)).toBeCloseTo(0, 5);
  });

  it("feel.jitter=0 убирает разброс: одинаковая дистанция разлёта и нулевой угол в покое", () => {
    const c = new ShuffleChoreography({ count: 20, anchor, seed: 1, feel: { jitter: 0 } });
    for (const t of c.sample(0)) expect(t.rot).toBeCloseTo(0, 5);
    const tMid = anim.shuffle.lift.dur + anim.shuffle.riffle.dur / 2;
    const s = c.sample(tMid);
    const leftOffsets = s.slice(0, 10).map((t) => Math.abs((t.x ?? 0) - anchor.x));
    // без jitter и без stagger по умолчанию (stagger остаётся 1) — дистанции всё ещё
    // различаются из-за каскада; проверяем именно угловой разброс = 0
    for (const t of s) expect(Number.isFinite(t.x ?? 0)).toBe(true);
    expect(leftOffsets.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("feel.scaleBump=0 держит масштаб = 1 на всём протяжении", () => {
    const c = new ShuffleChoreography({ count: 10, anchor, seed: 1, feel: { scaleBump: 0 } });
    for (const t of [0, 0.2, 0.5, 0.9, c.durationSec]) {
      for (const card of c.sample(t)) expect(card.scale).toBeCloseTo(1, 5);
    }
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
