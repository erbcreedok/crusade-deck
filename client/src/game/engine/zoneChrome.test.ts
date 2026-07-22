import { describe, expect, it } from "vitest";
import { DEAL_HAND_NOT_READY, DEAL_HAND_READY } from "../dealReadyTint";
import { COLORS } from "./constants";
import { noticeFontSize, zoneChrome, zoneLabelFontSize } from "./zoneChrome";

const IDLE = {
  zone: "center" as const,
  dragging: false,
  active: false,
  dragged: "deck" as const,
  dealMode: false,
  myReady: false,
};

describe("zoneChrome", () => {
  it("в покое заливки нет, подпись — название зоны", () => {
    const c = zoneChrome(IDLE);
    expect(c.fill).toBeNull();
    expect(c.label.text).toBe("стол");
    expect(c.label.alpha).toBeLessThan(0.2); // еле заметно
  });

  it("во время драга подпись меняется на действие — и зависит от того, что тащат", () => {
    expect(zoneChrome({ ...IDLE, dragging: true }).label.text).toBe("выложить на стол");
    expect(zoneChrome({ ...IDLE, dragging: true, dragged: "card" }).label.text).toBe("сыграть на стол");
  });

  it("зона под курсором подсвечивается ярче и толще", () => {
    const hover = zoneChrome({ ...IDLE, dragging: true, active: true });
    const drag = zoneChrome({ ...IDLE, dragging: true });
    expect(hover.stroke.width).toBeGreaterThan(drag.stroke.width);
    expect(hover.stroke.color).toBe(COLORS.hot);
    expect(hover.fill!.alpha).toBeGreaterThan(drag.fill!.alpha);
  });

  it("в раздаче полоса руки красится по готовности", () => {
    const ready = zoneChrome({ ...IDLE, zone: "hand", dealMode: true, myReady: true });
    const notReady = zoneChrome({ ...IDLE, zone: "hand", dealMode: true, myReady: false });
    expect(ready.stroke.color).toBe(DEAL_HAND_READY);
    expect(notReady.stroke.color).toBe(DEAL_HAND_NOT_READY);
  });

  it("ховер своей руки в раздаче — плотный оверлей с «раздать» тёмным по светлому", () => {
    const c = zoneChrome({ ...IDLE, zone: "hand", dealMode: true, myReady: true, dragging: true, active: true });
    expect(c.fill).toEqual({ color: DEAL_HAND_READY, alpha: 0.82 });
    expect(c.label.text).toBe("раздать");
    expect(c.label.tint).toBe(COLORS.ink);
  });

  it("себе раздать можно даже с myReady=false — подпись не превращается в «Неа»", () => {
    const c = zoneChrome({ ...IDLE, zone: "hand", dealMode: true, myReady: false, dragging: true, active: true });
    expect(c.label.text).toBe("раздать");
  });

  it("вне раздачи зона hand не красится акцентом готовности", () => {
    expect(zoneChrome({ ...IDLE, zone: "hand" }).stroke.color).toBe(COLORS.gold);
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

describe("noticeFontSize", () => {
  it("зажат в разумные границы", () => {
    expect(noticeFontSize(1)).toBe(34);
    expect(noticeFontSize(1000)).toBe(110);
  });
});
