import { describe, it, expect } from "vitest";
import {
  dealHandAccent,
  dealSeatHoverLabel,
  isDealReady,
  DEAL_HAND_READY,
  DEAL_HAND_NOT_READY,
  DEAL_HOVER_ACCEPT,
  DEAL_HOVER_REJECT,
} from "./dealReadyTint";

describe("isDealReady", () => {
  it("дилер всегда готов", () => {
    expect(isDealReady(false, true)).toBe(true);
    expect(isDealReady(true, true)).toBe(true);
  });

  it("обычный — только по флагу", () => {
    expect(isDealReady(false, false)).toBe(false);
    expect(isDealReady(true, false)).toBe(true);
  });
});

describe("dealHandAccent", () => {
  it("готов — жёлтый, не готов — серый", () => {
    expect(dealHandAccent(true)).toBe(DEAL_HAND_READY);
    expect(dealHandAccent(false)).toBe(DEAL_HAND_NOT_READY);
  });
});

describe("dealSeatHoverLabel", () => {
  it("готов — раздать, не готов — Неа", () => {
    expect(dealSeatHoverLabel(true)).toBe(DEAL_HOVER_ACCEPT);
    expect(dealSeatHoverLabel(false)).toBe(DEAL_HOVER_REJECT);
  });
});
