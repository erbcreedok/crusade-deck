import { describe, it, expect } from "vitest";
import { SHOUT_DUR, shoutEmojiOffset, shoutFontSize, shoutPose } from "./shout";

const at = (p: number) => shoutPose(p);
const samples = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n);

describe("shoutPose — клич «ГОУ!» пролетает через стол", () => {
  it("клич живёт около полутора секунд: успеть прочитать на лету", () => {
    expect(SHOUT_DUR).toBeGreaterThanOrEqual(1.2);
    expect(SHOUT_DUR).toBeLessThanOrEqual(1.6);
  });

  it("едет СПРАВА НАЛЕВО: стартует за правым краем, уходит за левый", () => {
    expect(at(0).x).toBeGreaterThan(1);
    expect(at(1).x).toBeLessThan(-1);
  });

  it("движение только в одну сторону — клич не мечется туда-обратно", () => {
    let prev = at(0).x;
    for (const p of samples(40).slice(1)) {
      const x = at(p).x;
      expect(x).toBeLessThanOrEqual(prev);
      prev = x;
    }
  });

  it("в середине пролёта надпись у центра — там её и читают", () => {
    expect(Math.abs(at(0.45).x)).toBeLessThan(0.2);
  });

  it("у центра почти замирает: середина пути медленнее краёв", () => {
    const speed = (a: number, b: number) => Math.abs(at(b).x - at(a).x);
    expect(speed(0.4, 0.5)).toBeLessThan(speed(0.05, 0.15));
    expect(speed(0.4, 0.5)).toBeLessThan(speed(0.85, 0.95));
  });

  it("дрожит: и по вертикали, и наклоном — знак меняется много раз", () => {
    const flips = (pick: (p: number) => number) => {
      let n = 0;
      let prev = pick(0);
      for (const p of samples(60).slice(1)) {
        const v = pick(p);
        if (v * prev < 0) n++;
        prev = v;
      }
      return n;
    };
    expect(flips((p) => at(p).shakeY)).toBeGreaterThan(8);
    expect(flips((p) => at(p).rot)).toBeGreaterThan(4);
  });

  it("дрожь остаётся в разумных пределах — надпись трясётся, а не разваливается", () => {
    for (const p of samples(60)) {
      expect(Math.abs(at(p).shakeY)).toBeLessThan(0.3);
      expect(Math.abs(at(p).rot)).toBeLessThan(0.15);
    }
  });

  it("въезжает УДАРОМ: мелкая на старте, с перехлёстом к концу заезда", () => {
    expect(at(0).scale).toBeLessThan(0.7);
    expect(Math.max(...samples(20).map((p) => at(p).scale))).toBeGreaterThan(1.2);
  });

  it("к центру оседает примерно в свой размер", () => {
    expect(at(0.5).scale).toBeGreaterThan(0.9);
    expect(at(0.5).scale).toBeLessThan(1.15);
  });

  it("виден почти весь пролёт, гаснет только у самого края", () => {
    expect(at(0).alpha).toBe(0);
    expect(at(0.5).alpha).toBe(1);
    expect(at(0.85).alpha).toBe(1);
    expect(at(1).alpha).toBe(0);
  });

  it("выход за границы не ломает позу", () => {
    expect(at(-1)).toEqual(at(0));
    expect(at(5)).toEqual(at(1));
  });
});

describe("раскладка клича", () => {
  const LEN = "ГОООООООООУУУ!!!".length;

  it("на узком телефоне клич читается целиком, когда идёт через центр", () => {
    const fs = shoutFontSize(320, LEN);
    expect(shoutEmojiOffset(fs, LEN) * 2).toBeLessThanOrEqual(320);
  });

  it("на широком экране кегль упирается в потолок — клич не раздувается бесконечно", () => {
    expect(shoutFontSize(3000, LEN)).toBe(shoutFontSize(6000, LEN));
  });

  it("кегль растёт вместе с экраном, пока не упрётся", () => {
    expect(shoutFontSize(600, LEN)).toBeGreaterThan(shoutFontSize(320, LEN));
  });

  it("вырожденный экран не роняет раскладку", () => {
    expect(shoutFontSize(0, LEN)).toBeGreaterThan(0);
    expect(shoutFontSize(320, 0)).toBeGreaterThan(0);
  });

  it("огоньки стоят по бокам от слова, а не поверх него", () => {
    const fs = 48;
    expect(shoutEmojiOffset(fs, LEN)).toBeGreaterThan((LEN * 0.62 * fs) / 2);
  });
});
