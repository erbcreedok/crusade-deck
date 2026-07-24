// Полёт карты между точками стола (раздача, сбор, сброс). Чистая математика — движок
// только рисует спрайт-призрак по этим числам, пока схема уже обновила стопки.

import { easeOutQuad } from "./anim/easing";

export interface FlightPoint {
  x: number;
  y: number;
  rot?: number;
}

export interface FlightPose {
  x: number;
  y: number;
  rot: number;
  alpha: number;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Поза на дуге from→to. t=0..1; lift — высота дуги в px. */
export function cardFlightPose(t: number, from: FlightPoint, to: FlightPoint, lift: number): FlightPose {
  const u = easeOutQuad(clamp01(t));
  const arc = Math.sin(Math.PI * u) * lift;
  return {
    x: lerp(from.x, to.x, u),
    y: lerp(from.y, to.y, u) - arc,
    rot: lerp(from.rot ?? 0, to.rot ?? 0, u),
    // Призрак непрозрачный: карта — плотный предмет, а не полтень. Раньше 1−u·0.15 давало
    // «блёклую» карту в полёте, из-за чего перелёт читался как спецэффект, а не как карта.
    alpha: 1,
  };
}

/** Откуда/куда летит карта в событиях сервера. "deck" — общая колода, иначе sessionId. */
export type CardPileId = "deck" | string;

export interface CardMove {
  card: string;
  from: CardPileId;
  to: CardPileId;
}
