import { describe, expect, it } from "vitest";
import { DEAL_HAND_NOT_READY, DEAL_HAND_READY } from "../dealReadyTint";
import { COLORS } from "./constants";
import { seatChrome, seatLabel, seatMarks } from "./seatChrome";

const BASE = { isDealer: false, isReady: false, connected: true };

describe("seatChrome", () => {

  it("отключённый игрок приглушён и рамкой, и содержимым", () => {
    const off = seatChrome({ ...BASE, connected: false });
    expect(off.border).toBe(COLORS.seatBorderOff);
    expect(off.alpha).toBe(0.45);
    expect(off.strokeAlpha).toBeLessThan(seatChrome(BASE).strokeAlpha);
  });

  it("цвет места решает готовность, а не роль", () => {
    expect(seatChrome({ ...BASE, isReady: true }).border).toBe(DEAL_HAND_READY);
    expect(seatChrome({ ...BASE, isReady: false }).border).toBe(DEAL_HAND_NOT_READY);
    // Дилер готов всегда, даже с isReady=false.
    expect(seatChrome({ ...BASE, isDealer: true }).border).toBe(DEAL_HAND_READY);
  });

  it("заливки у места нет — только тихая рамка", () => {
    expect(seatChrome(BASE).fill).toBe(false);
  });

  it("dealReady повторяет правило «дилер всегда принимает карты»", () => {
    expect(seatChrome({ ...BASE, isDealer: true, isReady: false }).dealReady).toBe(true);
    expect(seatChrome({ ...BASE, isReady: false }).dealReady).toBe(false);
  });

});

describe("seatMarks / seatLabel", () => {
  const seat = { name: "Аня", isBot: false, isDealer: false, isReady: false, handOpen: false };

  it("закрытая рука всегда даёт хотя бы замок", () => {
    expect(seatMarks(seat)).toBe("🔒");
    expect(seatLabel(seat)).toBe("Аня 🔒");
  });

  it("метки идут в стабильном порядке: бот, дилер, готовность, рука", () => {
    expect(seatMarks({ ...seat, isBot: true, isDealer: true, isReady: true, handOpen: true })).toBe("🤖 ♦ ✓ 🔓");
  });
});
