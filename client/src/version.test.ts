import { describe, it, expect } from "vitest";
import { BUILD_INFO, formatVersion, formatBuild } from "./version";

describe("версия сборки", () => {
  it("всегда что-то отдаёт, даже когда define не подставился", () => {
    expect(BUILD_INFO.version).toBeTruthy();
    expect(BUILD_INFO.build).toBeTruthy();
  });

  it("короткая подпись — версия с префиксом v", () => {
    expect(formatVersion({ version: "0.2.0", build: "a1b2c3d", builtAt: "" })).toBe("v0.2.0");
  });

  it("полная подпись содержит и версию, и билд — по нему видно, что залилось", () => {
    const s = formatBuild({ version: "0.2.0", build: "a1b2c3d", builtAt: "2026-07-23T10:00:00Z" });
    expect(s).toContain("0.2.0");
    expect(s).toContain("a1b2c3d");
  });

  it("без даты сборки не рисует пустой хвост", () => {
    const s = formatBuild({ version: "0.2.0", build: "dev", builtAt: "" });
    expect(s.trim()).toBe(s);
    expect(s.endsWith("·")).toBe(false);
  });

  it("дату показывает до минут — секунды в подписи только шумят", () => {
    const s = formatBuild({ version: "0.2.0", build: "a1b2c3d", builtAt: "2026-07-23T10:05:09Z" });
    expect(s).toContain("2026-07-23");
    expect(s).not.toContain(":09");
  });
});
