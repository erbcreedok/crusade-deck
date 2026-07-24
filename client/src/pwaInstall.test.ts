import { describe, expect, it } from "vitest";
import { detectInstallMode, isIos, isTelegram, type InstallEnv } from "./pwaInstall";

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
