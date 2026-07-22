import { describe, it, expect } from "vitest";
import { sanitizeDeckFx, FxRateLimiter, FX_MAX_DUR_MS, FX_MAX_AGE_MS } from "./deckFx.js";

describe("sanitizeDeckFx", () => {
  it("пропускает известные эффекты, проставляя серверное время", () => {
    const fx = sanitizeDeckFx({ kind: "flip-deck", angle: 1.2, dur: 400 }, 1000);
    expect(fx).toEqual({ kind: "flip-deck", angle: 1.2, dur: 400, cards: [], count: 0, t: 1000 });
  });

  it("отбрасывает мусор и неизвестные эффекты", () => {
    expect(sanitizeDeckFx(null, 0)).toBeNull();
    expect(sanitizeDeckFx({ kind: "дропнуть-базу", dur: 100 }, 0)).toBeNull();
    expect(sanitizeDeckFx({ dur: 100 }, 0)).toBeNull();
  });

  it("длительность зажимается — клиент не диктует серверу минуты анимации", () => {
    expect(sanitizeDeckFx({ kind: "stretch", dur: 999_999 }, 0)?.dur).toBe(FX_MAX_DUR_MS);
    expect(sanitizeDeckFx({ kind: "stretch", dur: -50 }, 0)?.dur).toBe(0);
    expect(sanitizeDeckFx({ kind: "stretch", dur: "быстро" }, 0)?.dur).toBe(0);
  });

  it("список карт чистится, длина ограничена", () => {
    const fx = sanitizeDeckFx({ kind: "flip-cards", cards: ["A♠", 5, null, "2♠"], dur: 200 }, 0);
    expect(fx?.cards).toEqual(["A♠", "2♠"]);
    const many = sanitizeDeckFx({ kind: "flip-cards", cards: Array(200).fill("A♠"), dur: 200 }, 0);
    expect(many!.cards.length).toBeLessThanOrEqual(64);
  });

  it("угол и количество приводятся к числам в разумных границах", () => {
    expect(sanitizeDeckFx({ kind: "spill", count: 999, dur: 300 }, 0)?.count).toBeLessThanOrEqual(16);
    expect(sanitizeDeckFx({ kind: "flip-deck", angle: NaN, dur: 300 }, 0)?.angle).toBe(0);
  });
});

describe("FxRateLimiter", () => {
  it("пропускает нормальный поток эффектов", () => {
    const rl = new FxRateLimiter(6, 1000);
    for (let i = 0; i < 6; i++) expect(rl.allow("a", i * 100)).toBe(true);
  });

  it("режет спам сверх лимита в окне", () => {
    const rl = new FxRateLimiter(3, 1000);
    for (let i = 0; i < 3; i++) rl.allow("a", 0);
    expect(rl.allow("a", 10)).toBe(false);
  });

  it("окно скользит — после паузы снова можно", () => {
    const rl = new FxRateLimiter(2, 1000);
    rl.allow("a", 0);
    rl.allow("a", 10);
    expect(rl.allow("a", 20)).toBe(false);
    expect(rl.allow("a", 1100)).toBe(true);
  });

  it("клиенты считаются раздельно", () => {
    const rl = new FxRateLimiter(1, 1000);
    expect(rl.allow("a", 0)).toBe(true);
    expect(rl.allow("b", 0)).toBe(true);
    expect(rl.allow("a", 0)).toBe(false);
  });
});

describe("границы", () => {
  it("возраст эффекта, после которого его уже не проигрывают, — доли секунды, не история", () => {
    expect(FX_MAX_AGE_MS).toBeGreaterThan(300);
    expect(FX_MAX_AGE_MS).toBeLessThanOrEqual(3000);
  });
});
