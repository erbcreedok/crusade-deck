import { clampFanWidth, fanMaxAngleDeg } from "../fan";
import { anim } from "../anim/config";
import type { FanGeom } from "./types";

// Геометрия НИЖНЕГО веера (полоса руки): якорь у верха зоны, провис и кнопка «сложить» —
// вниз. Веер колоды в центре считает layoutDeckFan (deckFan.ts) — там якорь другой,
// и попытка переиспользовать эту формулу уносила веер колоды на «вышку».
//
// Чистая математика: ни Pixi, ни состояния движка — только зона и число карт.

export interface HandFanOptions {
  /** Полоса руки (layout.handZone). */
  zone: { cx: number; cy: number; w: number; h: number };
  cardW: number;
  cardH: number;
  /** Сколько карт в вееере — от этого зажимаются шаг и угол. */
  count: number;
  /** Рука в фокусе: веер на всю полосу. Без фокуса — узкий спокойный. */
  focused: boolean;
  /** Идёт драг карты из этого веера: шаг допускаем шире (иначе дырка не видна). */
  dragging: boolean;
}

/**
 * Дуга веера до зажима по числу карт: якорь, ширина (вписанная в высоту зоны с учётом
 * места под кнопку «сложить») и угол крайних карт.
 */
export function fanArcGeom(
  zone: { cx: number; cy: number; w: number; h: number },
  cardH: number,
  focused: boolean,
): FanGeom {
  const anchor = { x: zone.cx, y: zone.cy - zone.h / 2 + cardH * 0.55 };
  const angleDeg = focused ? anim.fan.maxAngleDeg : anim.fan.maxAngleDeg * anim.fan.idle.angleScale;
  const maxA = (angleDeg * Math.PI) / 180;
  const reserved = cardH * 2 * anim.fan.collapse.hitRatio;
  const sagMax = Math.max(1, zone.h - cardH * 1.15 - reserved);
  const byHeight = maxA > 0 ? (2 * sagMax * Math.sin(maxA)) / (1 - Math.cos(maxA)) : Infinity;
  const fit = Math.min(zone.w, byHeight / anim.fan.widthFactor);
  const width = focused ? fit : fit * anim.fan.idle.widthScale;
  return { anchor, width, angleDeg };
}

/**
 * Зажим по числу карт: при малом их числе не растягивать шаг на всю полосу и не гнуть
 * крайние на полный maxAngleDeg (две карты — почти плоско).
 */
export function clampHandFan(geom: FanGeom, count: number, cardW: number, dragging: boolean): FanGeom {
  const maxStep = dragging ? anim.fan.maxStepDrag : anim.fan.maxStepIdle;
  return {
    ...geom,
    width: clampFanWidth(geom.width, count, cardW, anim.fan.widthFactor, maxStep),
    angleDeg: fanMaxAngleDeg(count, geom.angleDeg, anim.fan.maxStepAngleDeg),
  };
}

/** Готовая геометрия нижнего веера: дуга по зоне + зажим по числу карт. */
export function handFanGeom(o: HandFanOptions): FanGeom {
  return clampHandFan(fanArcGeom(o.zone, o.cardH, o.focused), o.count, o.cardW, o.dragging);
}
