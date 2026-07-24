import { Circle, Container, Graphics } from "pixi.js";
import { anim } from "../anim/config";
import { collapseAnchorBottom, fitCollapseButton } from "../collapseButton";
import { collapseRevealPose } from "../collapseReveal";
import { COLORS } from "./constants";
import type { ButtonLayout, FanGeom } from "./types";

// Круглая стрелка «сложить» под веером: раскладка, отрисовка и появление (slide-up + fade).
// Радиус считается, а не задан константой — иначе кнопка то налезала на карты, то висела
// в воздухе на других экранах (см. collapseButton.ts).

/** Куда и какого размера поставить кнопку под данным веером. */
export function layoutCollapseButton(zoneCx: number, fan: FanGeom, cardH: number): ButtonLayout {
  const fit = fitCollapseButton({
    cx: zoneCx,
    cardBottomY: collapseAnchorBottom(fan.anchor.y - cardH / 2, cardH),
    minR: Math.max(14, cardH * 0.24),
    maxR: cardH * anim.fan.collapse.hitRatio,
    obstacles: [],
  });
  return { x: fit.x, y: fit.y, r: fit.r };
}

/** Кружок с треугольником вниз. hitR — радиус хит-зоны, кружок рисуется чуть меньше. */
export function paintCollapseArrow(btn: Container, hitR: number): void {
  const visR = hitR * anim.fan.collapse.visualRatio;
  const g = btn.children[0] as Graphics;
  g.clear();
  g.circle(0, 0, visR).fill({ color: 0x14281c, alpha: 0.72 }).stroke({ width: 3, color: COLORS.gold, alpha: 0.65 });
  g.poly([-visR * 0.44, -visR * 0.16, visR * 0.44, -visR * 0.16, 0, visR * 0.42]).fill({
    color: COLORS.gold,
    alpha: 0.95,
  });
  btn.hitArea = new Circle(0, 0, hitR);
}

/**
 * Показать кнопку по текущей фазе появления. Кликабельной делаем только почти проявленную —
 * иначе палец попадал бы в полупрозрачную кнопку, которой «ещё нет».
 */
export function applyCollapseReveal(
  btn: Container | null,
  layout: ButtonLayout | null,
  reveal: number,
  wantShow: boolean,
  cardH: number,
): void {
  if (!btn) return;
  if (!layout || (reveal <= 0 && !wantShow)) {
    btn.visible = false;
    btn.alpha = 0;
    btn.eventMode = "none";
    return;
  }
  const pose = collapseRevealPose(reveal, layout.y, cardH * anim.fan.collapse.reveal.slide);
  btn.visible = true;
  btn.x = layout.x;
  btn.y = pose.y;
  btn.alpha = pose.alpha;
  btn.eventMode = reveal > 0.85 ? "static" : "none";
}

/**
 * Шаг появления/исчезновения: линейно едем к цели за reveal.dur (с поправкой на скорость
 * анимаций). Возвращает новое значение фазы 0..1.
 */
export function stepReveal(reveal: number, wantShow: boolean, dt: number, speed: number): number {
  const dur = Math.max(0.05, anim.fan.collapse.reveal.dur / Math.max(1, speed));
  const target = wantShow ? 1 : 0;
  if (reveal === target) return reveal;
  const step = dt / dur;
  return target > reveal ? Math.min(1, reveal + step) : Math.max(0, reveal - step);
}
