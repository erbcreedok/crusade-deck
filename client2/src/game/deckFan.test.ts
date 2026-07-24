import { describe, it, expect } from "vitest";
import { FAN_SCALE, fanCardScale } from "./deckFan";

describe("fanCardScale", () => {
  it("раскрытый веер чуть крупнее эталона — карты закрытой руки", () => {
    expect(fanCardScale(1)).toBe(FAN_SCALE);
    expect(fanCardScale(18)).toBe(FAN_SCALE);
    expect(FAN_SCALE).toBeGreaterThan(1);
    expect(FAN_SCALE).toBeLessThan(1.35);
  });

  it("размер НЕ зависит от числа карт, пока веер не стал тесным", () => {
    expect(fanCardScale(2)).toBe(fanCardScale(12));
  });

  it("больше восемнадцати — карты плавно ужимаются к эталону", () => {
    expect(fanCardScale(24)).toBeLessThan(FAN_SCALE);
    expect(fanCardScale(36)).toBeLessThan(fanCardScale(24));
    expect(fanCardScale(52)).toBeGreaterThan(0.9); // но мельче эталона не становятся
  });

  it("ужимание монотонное — размер не скачет от карты к карте", () => {
    let prev = fanCardScale(18);
    for (let n = 19; n <= 60; n++) {
      const cur = fanCardScale(n);
      expect(cur).toBeLessThanOrEqual(prev);
      prev = cur;
    }
  });
});
