import { describe, it, expect } from "vitest";
import { SHOUT_DUR, SHOUT_PEAK_SCALE, shoutEmojiOffset, shoutFontSize, shoutPose } from "./shout";

describe("shoutPose — клич «ГОУ!» поверх стола", () => {
  it("клич живёт около секунды: достаточно, чтобы прочитать, мало, чтобы мешать", () => {
    expect(SHOUT_DUR).toBeGreaterThanOrEqual(1);
    expect(SHOUT_DUR).toBeLessThanOrEqual(1.2);
  });

  it("появляется УДАРОМ: мелкий и прозрачный в самом начале", () => {
    const start = shoutPose(0);
    expect(start.scale).toBeLessThan(0.5);
    expect(start.alpha).toBe(0);
  });

  it("наезд с перехлёстом — крупнее итогового размера в первую четверть", () => {
    const peak = Math.max(...[0.1, 0.15, 0.2, 0.25].map((p) => shoutPose(p).scale));
    expect(peak).toBeGreaterThan(1.15);
  });

  it("к середине оседает примерно в свой размер и виден полностью", () => {
    const mid = shoutPose(0.5);
    expect(mid.scale).toBeCloseTo(1, 1);
    expect(mid.alpha).toBe(1);
  });

  it("к концу гаснет полностью — иначе надпись осталась бы висеть на столе", () => {
    expect(shoutPose(1).alpha).toBe(0);
    expect(shoutPose(0.9).alpha).toBeLessThan(1);
    expect(shoutPose(0.9).alpha).toBeGreaterThan(0);
  });

  it("затухание монотонное: клич гаснет, а не мигает", () => {
    let prev = shoutPose(0.7).alpha;
    for (const p of [0.75, 0.8, 0.85, 0.9, 0.95, 1]) {
      const a = shoutPose(p).alpha;
      expect(a).toBeLessThanOrEqual(prev);
      prev = a;
    }
  });

  it("выход за границы не ломает позу", () => {
    expect(shoutPose(-1)).toEqual(shoutPose(0));
    expect(shoutPose(5)).toEqual(shoutPose(1));
  });
});

describe("раскладка клича", () => {
  const LEN = "ГОООООУУУ!!!".length;

  it("на узком телефоне клич влезает в экран даже на пике удара", () => {
    const fs = shoutFontSize(320, LEN);
    const halfWidth = shoutEmojiOffset(fs, LEN) * SHOUT_PEAK_SCALE;
    expect(halfWidth * 2).toBeLessThanOrEqual(320);
  });

  it("на широком экране кегль упирается в потолок — клич не раздувается бесконечно", () => {
    expect(shoutFontSize(2000, LEN)).toBe(shoutFontSize(4000, LEN));
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
