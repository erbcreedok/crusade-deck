import { describe, it, expect } from "vitest";
import { FxClock, shouldPlayFx, FX_MAX_AGE_MS } from "./deckFxClient";

describe("FxClock", () => {
  it("первое событие считается свежим — сдвиг часов ещё неизвестен", () => {
    const c = new FxClock();
    expect(c.age(1000, 1500)).toBe(0);
  });

  it("после калибровки возраст меряется относительно самой быстрой доставки", () => {
    const c = new FxClock();
    c.age(1000, 1500); // сдвиг часов ≈ 500
    expect(c.age(2000, 2500)).toBe(0); // такая же доставка — свежее некуда
    expect(c.age(3000, 3800)).toBe(300); // на 300мс медленнее
  });

  it("сдвиг подтягивается вверх, если нашлась более быстрая доставка", () => {
    const c = new FxClock();
    c.age(1000, 1900);
    expect(c.age(2000, 2600)).toBe(0); // доставка быстрее — это и есть новый ноль
    expect(c.age(3000, 3900)).toBe(300);
  });
});

describe("shouldPlayFx", () => {
  it("свежий эффект играем, протухший пропускаем", () => {
    const c = new FxClock();
    expect(shouldPlayFx({ kind: "flip-deck", angle: 0, cards: [], count: 0, dur: 300, t: 1000 }, 1200, c)).toBe(true);
    expect(
      shouldPlayFx({ kind: "flip-deck", angle: 0, cards: [], count: 0, dur: 300, t: 2000 }, 2200 + FX_MAX_AGE_MS * 2, c),
    ).toBe(false);
  });

  it("порог возраста — доли секунды: упущенный момент не догоняем", () => {
    expect(FX_MAX_AGE_MS).toBeGreaterThan(300);
    expect(FX_MAX_AGE_MS).toBeLessThanOrEqual(3000);
  });
});
