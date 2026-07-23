import { describe, it, expect } from "vitest";
import { rejectionText, isRejectReason, rejectionKind } from "./rejections";

describe("rejectionText", () => {
  it("у каждой известной причины есть короткий человеческий текст", () => {
    for (const r of ["not_dealer", "not_lobby", "deal_mode", "empty_deck", "unknown_cards", "free_mode"] as const) {
      const t = rejectionText(r);
      expect(t.length).toBeGreaterThan(0);
      expect(t.length).toBeLessThanOrEqual(28); // это надпись поверх стола, а не абзац
    }
  });

  it("текст объясняет ПОЧЕМУ, а не просто «ошибка»", () => {
    expect(rejectionText("not_dealer")).toContain("дилер");
    expect(rejectionText("empty_deck")).toContain("олод");
    expect(rejectionText("deal_mode")).toContain("разда");
  });

  it("незнакомая причина не роняет клиент, а даёт нейтральный текст", () => {
    expect(rejectionText("что-то новое").length).toBeGreaterThan(0);
  });
});

describe("rejectionKind", () => {
  it("отказ на переворот возвращает карты обратно", () => {
    expect(rejectionKind("not_dealer")).toBe("flip");
    expect(rejectionKind("deal_mode")).toBe("flip");
  });

  it("режим свободы — не про переворот: только надпись, колоду не трогаем", () => {
    expect(rejectionKind("free_mode")).toBe("notice");
  });

  it("незнакомая причина — просто надпись: чужих карт не переворачиваем наугад", () => {
    expect(rejectionKind("что-то новое")).toBe("notice");
  });
});

describe("isRejectReason", () => {
  it("отличает известные причины от мусора", () => {
    expect(isRejectReason("not_dealer")).toBe(true);
    expect(isRejectReason("nope")).toBe(false);
    expect(isRejectReason(null)).toBe(false);
  });
});
