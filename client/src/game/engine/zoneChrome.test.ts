import { describe, expect, it } from "vitest";
import { DEAL_HAND_NOT_READY, DEAL_HAND_READY } from "../dealReadyTint";
import { COLORS } from "./constants";
import { noticeStyle, slotLabelY, zoneChrome, zoneLabelFontSize } from "./zoneChrome";

const IDLE = {
  live: true,
  zone: "center" as const,
  dragging: false,
  active: false,
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

  it("во время драга подпись меняется на действие — и зависит от того, что тащат", () => {
    expect(zoneChrome({ ...IDLE, dragging: true, dragged: "card" }).label.text).toBe("вернуть в колоду");
    expect(zoneChrome({ ...IDLE, dragging: true, dragged: "take" }).label.text).toBe("оставить на столе");
  });

  it("зона под курсором подсвечивается ярче и толще", () => {
    const hover = zoneChrome({ ...IDLE, dragging: true, active: true });
    const drag = zoneChrome({ ...IDLE, dragging: true });
    expect(hover.stroke.width).toBeGreaterThan(drag.stroke.width);
    expect(hover.stroke.color).toBe(COLORS.hot);
    expect(hover.fill!.alpha).toBeGreaterThan(drag.fill!.alpha);
  });

  it("полоса руки красится по готовности", () => {
    const ready = zoneChrome({ ...IDLE, zone: "hand", myReady: true });
    const notReady = zoneChrome({ ...IDLE, zone: "hand", myReady: false });
    expect(ready.stroke.color).toBe(DEAL_HAND_READY);
    expect(notReady.stroke.color).toBe(DEAL_HAND_NOT_READY);
  });

  it("ховер своей руки — плотный оверлей с «раздать» тёмным по светлому", () => {
    const c = zoneChrome({ ...IDLE, zone: "hand", myReady: true, dragging: true, active: true });
    expect(c.fill).toEqual({ color: DEAL_HAND_READY, alpha: 0.82 });
    expect(c.label.text).toBe("раздать");
    expect(c.label.tint).toBe(COLORS.ink);
  });

  it("себе раздать можно даже с myReady=false — подпись не превращается в «Неа»", () => {
    const c = zoneChrome({ ...IDLE, zone: "hand", myReady: false, dragging: true, active: true });
    expect(c.label.text).toBe("раздать");
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

describe("zoneChrome — погашенная зона", () => {
  it("не зовёт к себе карту: ни заливки, ни действия, только бледный контур", () => {
    const dead = zoneChrome({ ...IDLE, live: false, dragging: true, active: true, dragged: "card" });
    expect(dead.fill).toBeNull();
    expect(dead.label.text).toBe("стол"); // название зоны остаётся, действие — нет
    expect(dead.label.alpha).toBeLessThan(0.2);
    expect(dead.stroke.alpha).toBeLessThan(0.15);
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
