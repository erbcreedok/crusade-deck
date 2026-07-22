import { describe, it, expect } from "vitest";
import { computeLayout, type RoundedRect } from "./layout";

function inside(r: RoundedRect, w: number, h: number) {
  return r.cx - r.w / 2 >= -1 && r.cx + r.w / 2 <= w + 1 && r.cy - r.h / 2 >= -1 && r.cy + r.h / 2 <= h + 1;
}

describe("computeLayout", () => {
  it("зоны центра и сейфа занимают ≥80% ширины", () => {
    const l = computeLayout(800, 600);
    expect(l.centerZone.w).toBeGreaterThanOrEqual(800 * 0.8);
    expect(l.handZone.w + l.safeZone.w).toBeGreaterThanOrEqual(800 * 0.8);
  });

  it("все зоны вписаны в канвас", () => {
    const l = computeLayout(800, 600);
    expect(inside(l.centerZone, 800, 600)).toBe(true);
    expect(inside(l.safeZone, 800, 600)).toBe(true);
    expect(inside(l.handZone, 800, 600)).toBe(true);
  });

  it("нижняя полоса делится по вертикали: рука слева, сейф справа", () => {
    const l = computeLayout(800, 600);
    // одна горизонталь: рука и сейф стоят рядом, а не друг под другом
    expect(l.handZone.cy).toBeCloseTo(l.safeZone.cy, 0);
    expect(l.handZone.cx).toBeLessThan(l.safeZone.cx);
    // рука ~80% полосы, сейф ~20%
    const band = l.handZone.w + l.safeZone.w;
    expect(l.handZone.w / band).toBeGreaterThan(0.7);
    expect(l.safeZone.w / band).toBeLessThan(0.3);
    // не перекрываются
    expect(l.handZone.cx + l.handZone.w / 2).toBeLessThanOrEqual(l.safeZone.cx - l.safeZone.w / 2 + 1);
  });

  it("центр целиком выше нижней полосы", () => {
    const l = computeLayout(800, 600);
    expect(l.centerZone.cy + l.centerZone.h / 2).toBeLessThan(l.handZone.cy - l.handZone.h / 2);
  });

  it("в сейфе ровно три слота — до трёх отдельных колод", () => {
    const l = computeLayout(800, 600);
    expect(l.safeSlots.length).toBe(3);
    // слоты идут сверху вниз внутри сейфа и не вылезают из него
    const ys = l.safeSlots.map((s) => s.cy);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    for (const slot of l.safeSlots) {
      expect(slot.cy - slot.h / 2).toBeGreaterThanOrEqual(l.safeZone.cy - l.safeZone.h / 2 - 1);
      expect(slot.cy + slot.h / 2).toBeLessThanOrEqual(l.safeZone.cy + l.safeZone.h / 2 + 1);
    }
  });

  it("якоря колоды совпадают с центрами своих зон", () => {
    const l = computeLayout(800, 600);
    expect(l.deckAnchor).toEqual({ x: l.centerZone.cx, y: l.centerZone.cy });
    expect(l.handAnchor).toEqual({ x: l.handZone.cx, y: l.handZone.cy });
    expect(l.safeAnchors[0]).toEqual({ x: l.safeSlots[0].cx, y: l.safeSlots[0].cy });
  });

  it("карта имеет пропорции игральной (узкая по ширине)", () => {
    const l = computeLayout(800, 600);
    expect(l.cardW / l.cardH).toBeCloseTo(0.7, 1);
  });

  it("масштабируется: канвас крупнее → карта крупнее (до клампа)", () => {
    const small = computeLayout(320, 480);
    const big = computeLayout(1200, 900);
    expect(big.cardH).toBeGreaterThan(small.cardH);
  });

  it("размер карты ограничен сверху на огромном канвасе", () => {
    const huge = computeLayout(4000, 3000);
    expect(huge.cardH).toBeLessThanOrEqual(140);
  });

  it("устойчив к вырожденным размерам (0/крошечный) — без NaN и отрицательных размеров", () => {
    const l = computeLayout(0, 0);
    expect(Number.isFinite(l.centerZone.w)).toBe(true);
    expect(l.centerZone.w).toBeGreaterThanOrEqual(0);
    expect(l.cardH).toBeGreaterThan(0);
  });
});

// Чужие места (посадка «П») отжимают центр стола: сверху — полоса, по бокам — колонки.
describe("computeLayout с посадкой игроков", () => {
  const insets = { top: 80, left: 120, right: 120 };

  it("центр ужимается по ширине под боковые колонки", () => {
    const free = computeLayout(900, 700);
    const squeezed = computeLayout(900, 700, insets);
    expect(squeezed.centerZone.w).toBeLessThan(free.centerZone.w);
    expect(squeezed.centerZone.cx - squeezed.centerZone.w / 2).toBeGreaterThanOrEqual(insets.left - 1);
    expect(squeezed.centerZone.cx + squeezed.centerZone.w / 2).toBeLessThanOrEqual(900 - insets.right + 1);
  });

  it("центр не залезает под верхнюю полосу мест", () => {
    const l = computeLayout(900, 700, insets);
    expect(l.centerZone.cy - l.centerZone.h / 2).toBeGreaterThanOrEqual(insets.top - 1);
  });

  it("мои зоны (сейф и рука) от чужой посадки не зависят", () => {
    const free = computeLayout(900, 700);
    const squeezed = computeLayout(900, 700, insets);
    expect(squeezed.safeZone).toEqual(free.safeZone);
    expect(squeezed.handZone).toEqual(free.handZone);
  });

  it("якорь колоды едет вместе с ужатым центром", () => {
    const l = computeLayout(900, 700, insets);
    expect(l.deckAnchor).toEqual({ x: l.centerZone.cx, y: l.centerZone.cy });
  });

  it("абсурдные отступы не дают отрицательный центр", () => {
    const l = computeLayout(300, 500, { top: 400, left: 400, right: 400 });
    expect(l.centerZone.w).toBeGreaterThan(0);
    expect(l.centerZone.h).toBeGreaterThan(0);
  });
});

// Панель действий внизу — HTML фиксированной высоты поверх канваса. Игровые зоны
// обязаны заканчиваться НАД ней, иначе карты уезжают под кнопки.
describe("computeLayout с панелью действий внизу", () => {
  const insets = { top: 0, left: 0, right: 0, bottom: 90 };

  it("нижняя полоса (рука и сейф) не залезает под панель", () => {
    const l = computeLayout(800, 600, insets);
    expect(l.handZone.cy + l.handZone.h / 2).toBeLessThanOrEqual(600 - insets.bottom);
    expect(l.safeZone.cy + l.safeZone.h / 2).toBeLessThanOrEqual(600 - insets.bottom);
  });

  it("без панели полоса опускается ниже — отступ реально работает", () => {
    const free = computeLayout(800, 600);
    const raised = computeLayout(800, 600, insets);
    expect(raised.handZone.cy).toBeLessThan(free.handZone.cy);
  });

  it("центр по-прежнему выше нижней полосы", () => {
    const l = computeLayout(800, 600, insets);
    expect(l.centerZone.cy + l.centerZone.h / 2).toBeLessThan(l.handZone.cy - l.handZone.h / 2);
  });

  it("абсурдная панель не съедает зоны в ноль", () => {
    const l = computeLayout(400, 500, { top: 0, left: 0, right: 0, bottom: 5000 });
    expect(l.handZone.h).toBeGreaterThan(0);
    expect(l.safeZone.h).toBeGreaterThan(0);
    expect(l.centerZone.h).toBeGreaterThan(0);
  });
});
