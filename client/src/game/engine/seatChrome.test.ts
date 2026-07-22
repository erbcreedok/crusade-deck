import { describe, expect, it } from "vitest";
import { DEAL_HAND_NOT_READY, DEAL_HAND_READY } from "../dealReadyTint";
import { COLORS } from "./constants";
import { seatChrome, seatLabel, seatMarks } from "./seatChrome";

const BASE = { isDealer: false, isReady: false, connected: true, dealMode: false };

describe("seatChrome", () => {
  it("вне раздачи дилер — золотая рамка, обычный игрок — серо-зелёная", () => {
    expect(seatChrome({ ...BASE, isDealer: true }).border).toBe(COLORS.dealerBorder);
    expect(seatChrome(BASE).border).toBe(COLORS.seatBorder);
  });

  it("отключённый игрок приглушён и рамкой, и содержимым", () => {
    const off = seatChrome({ ...BASE, connected: false });
    expect(off.border).toBe(COLORS.seatBorderOff);
    expect(off.alpha).toBe(0.45);
    expect(off.strokeAlpha).toBeLessThan(seatChrome(BASE).strokeAlpha);
  });

  it("в раздаче цвет решает готовность, а не роль", () => {
    expect(seatChrome({ ...BASE, dealMode: true, isReady: true }).border).toBe(DEAL_HAND_READY);
    expect(seatChrome({ ...BASE, dealMode: true, isReady: false }).border).toBe(DEAL_HAND_NOT_READY);
    // Дилер готов всегда, даже с isReady=false.
    expect(seatChrome({ ...BASE, dealMode: true, isDealer: true }).border).toBe(DEAL_HAND_READY);
  });

  it("в раздаче заливки нет — только тихая рамка", () => {
    expect(seatChrome({ ...BASE, dealMode: true }).fill).toBe(false);
    expect(seatChrome(BASE).fill).toBe(true);
  });

  it("dealReady повторяет правило «дилер всегда принимает карты»", () => {
    expect(seatChrome({ ...BASE, dealMode: true, isDealer: true, isReady: false }).dealReady).toBe(true);
    expect(seatChrome({ ...BASE, dealMode: true, isReady: false }).dealReady).toBe(false);
  });

  it("вне раздачи акцента готовности нет", () => {
    expect(seatChrome({ ...BASE, isReady: true }).readyTint).toBeNull();
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
