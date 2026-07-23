import { describe, it, expect } from "vitest";
import { forbidDeckOpenTap } from "./forbidDeckOpen";

describe("forbidDeckOpenTap", () => {
  it("не-дилер тапает закрытую колоду в раздаче — запрет", () => {
    expect(forbidDeckOpenTap(true, false, false)).toBe(true);
  });

  it("дилер / уже открыта / не раздача — можно (или не этот жест)", () => {
    expect(forbidDeckOpenTap(true, true, false)).toBe(false);
    expect(forbidDeckOpenTap(true, false, true)).toBe(false);
    expect(forbidDeckOpenTap(false, false, false)).toBe(false);
  });

  it("в режиме свободы колода общая — тапнувшего не отчитываем", () => {
    expect(forbidDeckOpenTap(true, false, false, true)).toBe(false);
  });
});
