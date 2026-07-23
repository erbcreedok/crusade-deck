import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { BUILD_INFO, formatVersion, formatBuild, type BuildInfo } from "./version";

const info = (over: Partial<BuildInfo> = {}): BuildInfo => ({
  version: "0.2.0",
  build: "128",
  commit: "a1b2c3d",
  builtAt: "2026-07-23T10:05:09Z",
  ...over,
});

describe("версия сборки", () => {
  it("всегда что-то отдаёт, даже когда define не подставился", () => {
    expect(BUILD_INFO.version).toBeTruthy();
    expect(BUILD_INFO.build).toBeTruthy();
    expect(BUILD_INFO.commit).toBeTruthy();
  });

  // Две части: объявленная версия и номер сборки. Без второй две выкатки одной версии
  // неразличимы — а сравнивать чаще всего приходится именно их.
  it("короткая подпись — версия и номер сборки через плюс", () => {
    expect(formatVersion(info())).toBe("v0.2.0+128");
  });

  it("разные сборки одной версии различимы", () => {
    expect(formatVersion(info({ build: "128" }))).not.toBe(formatVersion(info({ build: "129" })));
  });

  it("полная подпись содержит версию, сборку и коммит", () => {
    const s = formatBuild(info());
    expect(s).toContain("0.2.0+128");
    expect(s).toContain("a1b2c3d");
  });

  it("без даты сборки не рисует пустой хвост", () => {
    const s = formatBuild(info({ builtAt: "" }));
    expect(s.trim()).toBe(s);
    expect(s.endsWith("·")).toBe(false);
  });

  it("дату показывает до минут — секунды в подписи только шумят", () => {
    const s = formatBuild(info());
    expect(s).toContain("2026-07-23");
    expect(s).not.toContain(":09");
  });

  // Версия объявляется в двух package.json, потому что у клиента и сервера РАЗНЫЕ
  // контексты сборки (docker build ./client и ./server) — общий файл в корне репозитория
  // ни одному из них не виден. Раз копии две, они обязаны совпадать, иначе прод покажет
  // одну версию в интерфейсе и другую в /health.
  it("версии клиента и сервера объявлены одинаково", () => {
    const require = createRequire(import.meta.url);
    const client = require("../package.json") as { version: string };
    const server = require("../../server/package.json") as { version: string };
    expect(server.version).toBe(client.version);
  });
});
