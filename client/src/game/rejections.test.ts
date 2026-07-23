import { describe, it, expect } from "vitest";
import { rejectionText, isRejectReason } from "./rejections";

describe("rejectionText", () => {
  it("у известной причины короткий человеческий текст", () => {
    const t = rejectionText("free_mode");
    expect(t.length).toBeGreaterThan(0);
    expect(t.length).toBeLessThanOrEqual(28); // это надпись поверх стола, а не абзац
  });

  it("текст объясняет ПОЧЕМУ, а не просто «ошибка»", () => {
    expect(rejectionText("free_mode")).toContain("сами");
  });

  it("незнакомая причина не роняет клиент, а даёт нейтральный текст", () => {
    expect(rejectionText("что-то новое").length).toBeGreaterThan(0);
  });
});

describe("isRejectReason", () => {
  it("отличает известные причины от мусора", () => {
    expect(isRejectReason("free_mode")).toBe(true);
    expect(isRejectReason("nope")).toBe(false);
    expect(isRejectReason(null)).toBe(false);
  });
});
