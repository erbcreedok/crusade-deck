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
  const free = { freeMode: true, deckCount: 36 };

  it("карты со стола берут кнопками: «Забрать 1» и «Забрать все»", () => {
    const a = barActionsFor(EMPTY_SELECTION, free);
    expect(a.main?.id).toBe("take_one");
    expect(a.main?.label).toContain("1");
    expect(a.secondary?.id).toBe("take_all");
    expect(a.secondary?.label).toContain("все");
  });

  it("кнопки одинаковы для всех: в свободе ролей за столом нет", () => {
    const dealer = barActionsFor(EMPTY_SELECTION, { ...free, amIDealer: true });
    const guest = barActionsFor(EMPTY_SELECTION, { ...free, amIDealer: false });
    expect(dealer).toEqual(guest);
  });

  it("свобода важнее раздачи: «ГОУ!» и «Перемешать» уступают место кнопкам взятия", () => {
    const a = barActionsFor(EMPTY_SELECTION, { ...free, amIDealer: true });
    expect(a.main?.id).not.toBe("shuffle");
    expect(a.secondary?.id).not.toBe("go");
  });

  it("колода разобрана — брать нечего, кнопок нет", () => {
    const a = barActionsFor(EMPTY_SELECTION, { ...free, deckCount: 0 });
    expect(a.main).toBeNull();
    expect(a.secondary).toBeNull();
  });

  it("перераздача с панели ушла — она живёт в меню у дилера", () => {
    const a = barActionsFor(EMPTY_SELECTION, { ...free, amIDealer: true });
    expect(a.main?.id).not.toBe("redeal");
    expect(a.secondary?.id).not.toBe("redeal");
  });
});
