import { describe, it, expect } from "vitest";
import { resolveProfile, shouldPlay, type AnimationProfile } from "./animationSettings";
import { anim } from "./config";

describe("resolveProfile", () => {
  it("выкл: motion off, приоритетный порог не пускает ничего", () => {
    const p = resolveProfile({ level: "off", speed: 1 });
    expect(p.motion).toBe(false);
    expect(shouldPlay(anim.priority.deal, p)).toBe(false);
  });

  it("полная: весь фил включён", () => {
    const p = resolveProfile({ level: "full", speed: 1 });
    expect(p).toMatchObject({ motion: true, tilt: true, scaleBump: true, jitter: 1, stagger: 1 });
    expect(p.minPriority).toBe(anim.priority.idle);
  });

  it("умеренная: режет фреймрейт, гасит juice, ужимает каскад/разброс", () => {
    const p = resolveProfile({ level: "moderate", speed: 1 });
    expect(p.motion).toBe(true);
    expect(p.tilt).toBe(false);
    expect(p.scaleBump).toBe(false);
    expect(p.fpsCap).toBeLessThan(resolveProfile({ level: "full", speed: 1 }).fpsCap);
    expect(p.jitter).toBeGreaterThan(0);
    expect(p.jitter).toBeLessThan(1);
    expect(p.stagger).toBeLessThan(1);
  });

  it("скорость пробрасывается в профиль как множитель времени", () => {
    for (const speed of [1, 2, 4] as const) {
      expect(resolveProfile({ level: "full", speed }).speed).toBe(speed);
      expect(resolveProfile({ level: "moderate", speed }).speed).toBe(speed);
    }
  });
});

describe("shouldPlay — приоритеты", () => {
  const full = resolveProfile({ level: "full", speed: 1 });
  const moderate = resolveProfile({ level: "moderate", speed: 1 });

  it("полная пускает и idle, и растасовку", () => {
    expect(shouldPlay(anim.priority.idle, full)).toBe(true);
    expect(shouldPlay(anim.priority.shuffle, full)).toBe(true);
  });

  it("умеренная отсекает низкоприоритетное (idle), но пускает важное", () => {
    expect(shouldPlay(anim.priority.idle, moderate)).toBe(false);
    expect(shouldPlay(anim.priority.shuffle, moderate)).toBe(true);
    expect(shouldPlay(anim.priority.deal, moderate)).toBe(true);
  });

  it("motion off никогда не пускает", () => {
    const off: AnimationProfile = resolveProfile({ level: "off", speed: 1 });
    expect(shouldPlay(anim.priority.deal, off)).toBe(false);
  });
});
