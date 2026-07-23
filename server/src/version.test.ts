import { describe, it, expect } from "vitest";
import { BUILD_INFO, formatVersion } from "./version.js";

describe("версия сервера", () => {
  it("версия читается из package.json, а не остаётся заглушкой", () => {
    expect(BUILD_INFO.version).not.toBe("0.0.0");
    expect(BUILD_INFO.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("номер сборки и коммит всегда чем-то заполнены", () => {
    expect(BUILD_INFO.build).toBeTruthy();
    expect(BUILD_INFO.commit).toBeTruthy();
  });

  // Формат общий с клиентом (client/src/version.ts): подписи сравнивают глазами, и
  // расхождение в самом формате мешало бы это делать.
  it("подпись — та же, что у клиента: версия и номер сборки через плюс", () => {
    expect(formatVersion({ version: "0.2.0", build: "128", commit: "a1b2c3d" })).toBe("v0.2.0+128");
  });
});
