import { describe, expect, it } from "vitest";
import { clampHandFan, fanArcGeom, handFanGeom } from "./fanGeometry";

const ZONE = { cx: 200, cy: 500, w: 360, h: 220 };
const CARD_W = 60;
const CARD_H = 86;

describe("fanArcGeom", () => {
  it("якорь стоит у ВЕРХА полосы — провис веера уходит вниз", () => {
    const g = fanArcGeom(ZONE, CARD_H, true);
    expect(g.anchor.x).toBe(ZONE.cx);
    expect(g.anchor.y).toBeLessThan(ZONE.cy); // выше центра зоны
    expect(g.anchor.y).toBeGreaterThan(ZONE.cy - ZONE.h / 2); // но внутри неё
  });

  it("в фокусе веер шире и круче, чем в покое", () => {
    const focused = fanArcGeom(ZONE, CARD_H, true);
    const idle = fanArcGeom(ZONE, CARD_H, false);
    expect(focused.width).toBeGreaterThan(idle.width);
    expect(focused.angleDeg).toBeGreaterThan(idle.angleDeg);
  });

  it("ширина не вылезает за полосу", () => {
    const g = fanArcGeom(ZONE, CARD_H, true);
    expect(g.width).toBeLessThanOrEqual(ZONE.w);
  });

  it("низкая зона ужимает веер (место под кнопку «сложить» зарезервировано)", () => {
    const low = fanArcGeom({ ...ZONE, h: 110 }, CARD_H, true);
    const tall = fanArcGeom({ ...ZONE, h: 220 }, CARD_H, true);
    expect(low.width).toBeLessThanOrEqual(tall.width);
  });
});

describe("clampHandFan", () => {
  it("две карты не расползаются на всю полосу", () => {
    const arc = fanArcGeom(ZONE, CARD_H, true);
    const few = clampHandFan(arc, 2, CARD_W, false);
    const many = clampHandFan(arc, 20, CARD_W, false);
    expect(few.width).toBeLessThan(many.width);
  });

  it("на малом числе карт угол крайних тоже мягче", () => {
    const arc = fanArcGeom(ZONE, CARD_H, true);
    expect(clampHandFan(arc, 2, CARD_W, false).angleDeg).toBeLessThan(arc.angleDeg + 1e-9);
  });

  it("во время драга шаг допускается шире, чем в покое", () => {
    const arc = fanArcGeom(ZONE, CARD_H, true);
    const idle = clampHandFan(arc, 3, CARD_W, false);
    const drag = clampHandFan(arc, 3, CARD_W, true);
    expect(drag.width).toBeGreaterThanOrEqual(idle.width);
  });
});

describe("handFanGeom", () => {
  it("это композиция дуги и зажима — результат совпадает с ручной сборкой", () => {
    const manual = clampHandFan(fanArcGeom(ZONE, CARD_H, true), 5, CARD_W, false);
    const combined = handFanGeom({
      zone: ZONE,
      cardW: CARD_W,
      cardH: CARD_H,
      count: 5,
      focused: true,
      dragging: false,
    });
    expect(combined).toEqual(manual);
  });
});
