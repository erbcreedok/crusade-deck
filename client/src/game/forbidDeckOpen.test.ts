import { describe, it, expect } from "vitest";
import { forbidDeckOpenTap } from "./forbidDeckOpen";

describe("forbidDeckOpenTap", () => {
  it("не-дилер тапает закрытую колоду — запрет", () => {
    expect(forbidDeckOpenTap(false, false)).toBe(true);
  });

  it("дилер или уже раскрытый веер — не этот жест", () => {
    expect(forbidDeckOpenTap(true, false)).toBe(false);
    expect(forbidDeckOpenTap(false, true)).toBe(false);
  });

  it("в режиме свободы колода общая — тапнувшего не отчитываем", () => {
    expect(forbidDeckOpenTap(false, false, true)).toBe(false);
  });
});
