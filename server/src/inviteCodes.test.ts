import { describe, it, expect } from "vitest";
import { registerInviteCode, resolveInviteCode, releaseInviteCode } from "./inviteCodes.js";

describe("inviteCodes", () => {
  it("registers a 6-digit code that resolves back to the roomId", () => {
    const code = registerInviteCode("room-1");
    expect(code).toMatch(/^\d{6}$/);
    expect(resolveInviteCode(code)).toBe("room-1");
  });

  it("returns undefined for a code that was never issued", () => {
    // "000000" никогда не может быть сгенерирован (диапазон 100000-999999)
    expect(resolveInviteCode("000000")).toBeUndefined();
  });

  it("frees the code up after release, so it no longer resolves", () => {
    const code = registerInviteCode("room-2");
    releaseInviteCode(code);
    expect(resolveInviteCode(code)).toBeUndefined();
  });

  it("never hands out the same code to two different rooms at once", () => {
    const codes = new Set(Array.from({ length: 200 }, (_, i) => registerInviteCode(`room-batch-${i}`)));
    expect(codes.size).toBe(200);
  });
});
