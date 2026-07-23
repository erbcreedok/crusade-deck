import { describe, it, expect } from "vitest";
import { barActionsFor } from "./barActions";
import { EMPTY_SELECTION } from "./selection";

// Состояний стола два: раздача (дилер крутит колоду) и свобода после «ГОУ!».
describe("barActionsFor — раздача", () => {
  it("дилер: Перемешать + ГОУ!", () => {
    const a = barActionsFor(EMPTY_SELECTION, { amIDealer: true });
    expect(a.main?.id).toBe("shuffle");
    expect(a.secondary?.id).toBe("go");
    expect(a.secondary?.label).toContain("ГОУ");
  });

  it("у действий есть человеческие подписи", () => {
    const a = barActionsFor(EMPTY_SELECTION, { amIDealer: true });
    expect(a.main?.label.trim()).not.toBe("");
    expect(a.secondary?.label.trim()).not.toBe("");
  });

  it("игрок: Готов / Ждите…", () => {
    const a = barActionsFor(EMPTY_SELECTION, { amIDealer: false, myReady: false });
    expect(a.main?.id).toBe("ready");
    expect(a.secondary?.id).toBe("wait");
  });

  it("игрок готовый: Не готов", () => {
    const a = barActionsFor(EMPTY_SELECTION, { amIDealer: false, myReady: true });
    expect(a.main?.id).toBe("unready");
  });
});

describe("barActionsFor — режим свободы", () => {
  const free = { freeMode: true };

  it("дилер: главное действие — Перераздача", () => {
    const a = barActionsFor(EMPTY_SELECTION, { ...free, amIDealer: true });
    expect(a.main?.id).toBe("redeal");
    expect(a.main?.label).toContain("Перераздача");
  });

  it("свобода важнее раздачи: «ГОУ!» и «Перемешать» уступают место Перераздаче", () => {
    const a = barActionsFor(EMPTY_SELECTION, { ...free, amIDealer: true });
    expect(a.secondary?.id).not.toBe("go");
    expect(a.main?.id).not.toBe("shuffle");
  });

  it("остальным в свободе кнопок нет — карты берут жестом со стола", () => {
    const a = barActionsFor(EMPTY_SELECTION, { ...free, amIDealer: false });
    expect(a.main).toBeNull();
    expect(a.secondary).toBeNull();
  });
});
