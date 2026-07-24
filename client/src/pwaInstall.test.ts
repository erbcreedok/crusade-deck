import { describe, expect, it } from "vitest";
import { detectInstallMode, iosBrowser, isIos, isTelegram, type InstallEnv } from "./pwaInstall";

const base: InstallEnv = { standalone: false, ios: false, telegram: false, canPrompt: false };

describe("detectInstallMode", () => {
  it("standalone важнее всего — ничего не предлагаем", () => {
    expect(detectInstallMode({ ...base, standalone: true, telegram: true, canPrompt: true })).toBe("installed");
  });

  it("Telegram важнее нативного промпта и iOS — зовём в настоящий браузер", () => {
    expect(detectInstallMode({ ...base, telegram: true, canPrompt: true, ios: true })).toBe("telegram");
  });

  it("Android/Chrome с пойманным промптом → кнопка установки", () => {
    expect(detectInstallMode({ ...base, canPrompt: true })).toBe("android");
  });

  it("iOS Safari без промпта → инструкция", () => {
    expect(detectInstallMode({ ...base, ios: true })).toBe("ios");
  });

  it("десктоп без промпта → ничего", () => {
    expect(detectInstallMode(base)).toBe("none");
  });
});

describe("isIos / isTelegram", () => {
  it("узнаёт iPhone по userAgent", () => {
    expect(isIos("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
    expect(isIos("Mozilla/5.0 (Linux; Android 13)")).toBe(false);
  });

  it("узнаёт браузер Telegram по userAgent", () => {
    expect(isTelegram("Mozilla/5.0 ... Telegram-Android/10.0")).toBe(true);
    expect(isTelegram("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe(false);
  });
});

describe("iosBrowser", () => {
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";

  it("настоящий Safari — есть Version/ и Safari, без чужих меток", () => {
    expect(iosBrowser(`${IPHONE} (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1`)).toBe("safari");
  });

  it("Chrome на iPhone — по CriOS (а не Safari, хоть Safari в UA и есть)", () => {
    expect(iosBrowser(`${IPHONE} (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1`)).toBe("chrome");
  });

  it("Firefox / Edge / Opera / Yandex на iOS распознаются каждый свой", () => {
    expect(iosBrowser(`${IPHONE} FxiOS/120.0 Mobile/15E148 Safari/605.1.15`)).toBe("firefox");
    expect(iosBrowser(`${IPHONE} EdgiOS/120.0 Mobile/15E148 Safari/605.1.15`)).toBe("edge");
    expect(iosBrowser(`${IPHONE} OPiOS/16.0 Mobile/15E148 Safari/9537.53`)).toBe("opera");
    expect(iosBrowser(`${IPHONE} YaBrowser/23.0 Mobile/15E148 Safari/604.1`)).toBe("yandex");
  });

  it("встроенный вебвью (без Version/, напр. Telegram) — unknown", () => {
    expect(iosBrowser(`${IPHONE} Mobile/15E148`)).toBe("unknown");
  });
});
