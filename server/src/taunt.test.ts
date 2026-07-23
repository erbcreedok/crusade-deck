import { describe, expect, it } from "vitest";
import { sanitizeTaunt } from "./taunt";

describe("sanitizeTaunt — сервер пропускает только известные кричалки", () => {
  it("пропускает известный вид", () => {
    expect(sanitizeTaunt({ kind: "gkh" })).toBe("gkh");
    expect(sanitizeTaunt({ kind: "suck" })).toBe("suck");
  });

  it("отбрасывает выдуманный вид", () => {
    expect(sanitizeTaunt({ kind: "что угодно" })).toBeNull();
  });

  it("отбрасывает мусор вместо сообщения", () => {
    expect(sanitizeTaunt(null)).toBeNull();
    expect(sanitizeTaunt("gkh")).toBeNull();
    expect(sanitizeTaunt({})).toBeNull();
  });

  it("не тащит чужие поля: наружу уходит только вид", () => {
    // Автора подставляет сервер — то, что клиент прислал своё «from», значения не имеет.
    expect(sanitizeTaunt({ kind: "gkh", from: "чужой-id", text: "<script>" })).toBe("gkh");
  });
});
