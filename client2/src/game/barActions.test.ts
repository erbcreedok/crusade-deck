import { describe, it, expect } from "vitest";
import { barActionsFor } from "./barActions";
import { EMPTY_SELECTION } from "./selection";
import { TAUNT_LABEL } from "./taunt";

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

  it("панель отдана кричалкам: карты со стола берут пальцем, а не кнопкой", () => {
    const a = barActionsFor(EMPTY_SELECTION, free);
    expect(a.main?.id).toBe("taunt_gkh");
    expect(a.main?.label).toBe(TAUNT_LABEL.gkh);
    expect(a.secondary?.id).toBe("taunt_suck");
    expect(a.secondary?.label).toBe(TAUNT_LABEL.suck);
  });

  it("кнопки одинаковы для всех: в свободе ролей за столом нет", () => {
    const dealer = barActionsFor(EMPTY_SELECTION, { ...free, amIDealer: true });
    const guest = barActionsFor(EMPTY_SELECTION, { ...free, amIDealer: false });
    expect(dealer).toEqual(guest);
  });

  it("свобода важнее раздачи: «ГОУ!» и «Перемешать» уступают место кричалкам", () => {
    const a = barActionsFor(EMPTY_SELECTION, { ...free, amIDealer: true });
    expect(a.main?.id).not.toBe("shuffle");
    expect(a.secondary?.id).not.toBe("go");
  });

  it("пустой стол кричалок не отменяет: кричать можно и когда карт не осталось", () => {
    const a = barActionsFor(EMPTY_SELECTION, { ...free, deckCount: 0 });
    expect(a.main?.id).toBe("taunt_gkh");
    expect(a.secondary?.id).toBe("taunt_suck");
  });

  it("перераздача с панели ушла — она живёт в меню у дилера", () => {
    const a = barActionsFor(EMPTY_SELECTION, { ...free, amIDealer: true });
    expect(a.main?.id).not.toBe("redeal");
    expect(a.secondary?.id).not.toBe("redeal");
  });
});
