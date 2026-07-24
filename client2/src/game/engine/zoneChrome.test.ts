import { describe, expect, it } from "vitest";
import { DEAL_HAND_NOT_READY, DEAL_HAND_READY } from "../dealReadyTint";
import { COLORS } from "./constants";
import { noticeStyle, slotLabelY, zoneChrome, zoneLabelFontSize } from "./zoneChrome";

const IDLE = {
  live: true,
  zone: "center" as const,
  dragging: false,
  hovered: false,
  dragged: "card" as const,
  myReady: false,
  inGame: false,
};

describe("zoneChrome", () => {
  it("в покое заливки нет, подпись — название зоны", () => {
    const c = zoneChrome(IDLE);
    expect(c.fill).toBeNull();
    expect(c.label.text).toBe("стол");
    expect(c.label.alpha).toBeLessThan(0.2); // еле заметно
  });

  it("во время драга подпись меняется на КРАТКИЙ глагол", () => {
    expect(zoneChrome({ ...IDLE, dragging: true, dragged: "card" }).label.text).toBe("в колоду");
    expect(zoneChrome({ ...IDLE, inGame: true, dragging: true, dragged: "take" }).label.text).toBe("на стол");
    expect(zoneChrome({ ...IDLE, zone: "discard", dragging: true }).label.text).toBe("сброс");
  });

  it("доступная зона под драгом получает полупрозрачный фон", () => {
    const c = zoneChrome({ ...IDLE, dragging: true });
    expect(c.fill).not.toBeNull();
    expect(c.fill!.alpha).toBeGreaterThan(0.1);
  });

  it("наведённая зона — почти непрозрачный фон и глагол поверх карт", () => {
    const hover = zoneChrome({ ...IDLE, dragging: true, hovered: true });
    const drag = zoneChrome({ ...IDLE, dragging: true });
    expect(hover.stroke.width).toBeGreaterThan(drag.stroke.width);
    expect(hover.fill!.alpha).toBeGreaterThan(0.8); // почти непрозрачный
    expect(hover.fill!.alpha).toBeGreaterThan(drag.fill!.alpha);
    expect(hover.hoverText).not.toBeNull(); // глагол рисуется ПОВЕРХ карт бокса
    expect(hover.label.alpha).toBe(0); // а на слое зон он спрятан (виден только верхний)
  });

  it("полоса руки красится по готовности", () => {
    const ready = zoneChrome({ ...IDLE, zone: "hand", myReady: true });
    const notReady = zoneChrome({ ...IDLE, zone: "hand", myReady: false });
    expect(ready.stroke.color).toBe(DEAL_HAND_READY);
    expect(notReady.stroke.color).toBe(DEAL_HAND_NOT_READY);
  });

  it("ховер своей руки в РАЗДАЧЕ — краткое «на!» тёмным по светлому", () => {
    const c = zoneChrome({ ...IDLE, zone: "hand", myReady: true, dragging: true, hovered: true });
    expect(c.hoverText!.text).toBe("на!"); // раздать карту сюда
    expect(c.hoverText!.tint).toBe(COLORS.ink);
  });
});

describe("zoneLabelFontSize", () => {
  it("узкая зона ужимает шрифт", () => {
    expect(zoneLabelFontSize("center", 60, 90)).toBeLessThan(zoneLabelFontSize("center", 400, 90));
  });

  it("шрифт не уходит ниже читаемого минимума", () => {
    expect(zoneLabelFontSize("center", 1, 90)).toBe(9);
  });

  it("растёт с размером карты, но упирается в потолок", () => {
    expect(zoneLabelFontSize("center", 800, 40)).toBeLessThan(zoneLabelFontSize("center", 800, 200));
    expect(zoneLabelFontSize("center", 800, 5000)).toBe(44);
  });
});

describe("zoneChrome — недоступная зона", () => {
  it("без ховера остаётся спокойной: ни заливки, ни глагола", () => {
    const dead = zoneChrome({ ...IDLE, live: false, dragging: true, dragged: "card" });
    expect(dead.fill).toBeNull();
    expect(dead.label.text).toBe("стол"); // название остаётся, зова к себе нет
    expect(dead.label.alpha).toBeLessThan(0.2);
  });

  it("под наведённой картой — серый плотный оверлей и «низя»", () => {
    const forbidden = zoneChrome({ ...IDLE, live: false, dragging: true, hovered: true });
    expect(forbidden.fill).not.toBeNull();
    expect(forbidden.fill!.alpha).toBeGreaterThan(0.7); // плотный туман запрета
    expect(forbidden.hoverText!.text).toBe("низя"); // «низя» тоже поверх карт
    expect(forbidden.label.alpha).toBe(0);
  });
});

describe("slotLabelY", () => {
  const rect = { cy: 400, h: 120 };

  it("подпись стоит НАД боксом, а не внутри и не под ним", () => {
    expect(slotLabelY(rect, 100)).toBeLessThan(rect.cy - rect.h / 2);
  });

  it("отступ растёт вместе с картой — на большом столе подпись не липнет к рамке", () => {
    expect(slotLabelY(rect, 200)).toBeLessThan(slotLabelY(rect, 100));
  });
});

describe("noticeStyle", () => {
  const W = 390; // обычный телефон

  it("короткое слово остаётся крупным", () => {
    expect(noticeStyle(90, W, "низяяя").fontSize).toBeGreaterThan(60);
  });

  it("длинная фраза ужимается — иначе её обрезало бы краями экрана", () => {
    const long = noticeStyle(90, W, "карты берут сами").fontSize;
    expect(long).toBeLessThan(noticeStyle(90, W, "низяяя").fontSize);
  });

  it("фраза ложится в строку переноса: две строки, а не обрезок", () => {
    const { fontSize, wrapWidth } = noticeStyle(90, W, "карты берут сами");
    const halfPhrase = Math.ceil("карты берут сами".length / 2) + 1;
    expect(halfPhrase * 0.62 * fontSize).toBeLessThanOrEqual(wrapWidth + 1e-9);
    expect(wrapWidth).toBeLessThan(W); // с полями, а не впритык к краям
  });

  it("самое длинное слово влезает в строку целиком", () => {
    const { fontSize, wrapWidth } = noticeStyle(90, W, "этих карт нет в колоде");
    expect("колоде".length * 0.62 * fontSize).toBeLessThanOrEqual(wrapWidth + 1e-9);
  });

  it("кегль зажат в разумные границы", () => {
    expect(noticeStyle(1, W, "низяяя").fontSize).toBe(34);
    expect(noticeStyle(1000, 4000, "низяяя").fontSize).toBe(110);
    expect(noticeStyle(1000, 100, "очень длинная причина отказа").fontSize).toBe(18);
  });
});
