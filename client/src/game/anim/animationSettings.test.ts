import { describe, it, expect } from "vitest";
import { resolveProfile, shouldPlay } from "./animationSettings";
import { anim } from "./config";

describe("resolveProfile", () => {
  it("полная: весь фил включён, растасовка — риффл", () => {
    const p = resolveProfile({ level: "full", speed: 1 });
    expect(p).toMatchObject({ tilt: true, scaleBump: true, jitter: 1, stagger: 1, shuffleVariant: "riffle" });
    expect(p.minPriority).toBe(anim.priority.idle);
  });

  it("умеренная: режет фреймрейт, гасит juice, растасовка — короткий оборот", () => {
    const p = resolveProfile({ level: "moderate", speed: 1 });
    expect(p.tilt).toBe(false);
    expect(p.scaleBump).toBe(false);
    expect(p.shuffleVariant).toBe("spin");
    expect(p.fpsCap).toBeLessThan(resolveProfile({ level: "full", speed: 1 }).fpsCap);
    expect(p.minPriority).toBe(anim.priority.shuffle);
  });

  it("скорость пробрасывается в профиль как множитель времени (1/2/3)", () => {
    for (const speed of [1, 2, 3] as const) {
      expect(resolveProfile({ level: "full", speed }).speed).toBe(speed);
      expect(resolveProfile({ level: "moderate", speed }).speed).toBe(speed);
    }
  });
});

describe("shouldPlay — приоритеты", () => {
  const full = resolveProfile({ level: "full", speed: 1 });
  const moderate = resolveProfile({ level: "moderate", speed: 1 });

  it("растасовка проигрывается на обоих уровнях (всегда включена)", () => {
    expect(shouldPlay(anim.priority.shuffle, full)).toBe(true);
    expect(shouldPlay(anim.priority.shuffle, moderate)).toBe(true);
  });

  it("полная пускает и idle, умеренная — отсекает низкоприоритетное", () => {
    expect(shouldPlay(anim.priority.idle, full)).toBe(true);
    expect(shouldPlay(anim.priority.idle, moderate)).toBe(false);
    expect(shouldPlay(anim.priority.deal, moderate)).toBe(true);
  });
});
