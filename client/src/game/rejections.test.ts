import { describe, it, expect } from "vitest";
import { rejectionText, isRejectReason } from "./rejections";

describe("rejectionText", () => {
  it("у каждой известной причины есть короткий человеческий текст", () => {
    for (const r of ["not_dealer", "not_lobby", "empty_deck", "unknown_cards"] as const) {
      const t = rejectionText(r);
      expect(t.length).toBeGreaterThan(0);
      expect(t.length).toBeLessThanOrEqual(28); // это надпись поверх стола, а не абзац
    }
  });

  it("текст объясняет ПОЧЕМУ, а не просто «ошибка»", () => {
    expect(rejectionText("not_dealer")).toContain("дилер");
    expect(rejectionText("empty_deck")).toContain("олод");
  });

  it("незнакомая причина не роняет клиент, а даёт нейтральный текст", () => {
    expect(rejectionText("что-то новое").length).toBeGreaterThan(0);
  });
});

describe("isRejectReason", () => {
  it("отличает известные причины от мусора", () => {
    expect(isRejectReason("not_dealer")).toBe(true);
    expect(isRejectReason("nope")).toBe(false);
    expect(isRejectReason(null)).toBe(false);
  });
});
