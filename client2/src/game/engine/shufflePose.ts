import { easeOutQuad } from "../anim/easing";
import { lerp } from "../mathUtil";
import type { ShufflePose } from "./types";

// Поза одной карты в настоящей растасовке: она летит из старого слота в новый по дуге,
// с боковым выносом и креном. Числа (насколько высоко, далеко, долго) считает
// shuffleFlight.ts по дельте карты — здесь только сама траектория.
//
// Дуга нужна не для красоты: без подъёма и выноса перелёт ближней карты читается как
// подмена картинки на месте, а не как перемещение.

export interface ShuffleFlightShape {
  from: ShufflePose;
  to: ShufflePose;
  /** Высота дуги. */
  lift: number;
  /** Боковой вынос на апексе (знак = сторона). */
  bulge: number;
  /** Крен в сторону выноса. */
  lean: number;
}

/** Прогресс карты 0..1 по общему времени анимации с учётом её задержки в каскаде. */
export function shuffleProgress(t: number, delay: number, dur: number): number {
  const local = t - delay;
  if (local < 0) return -1; // ещё не стартовала: стоит на месте
  return Math.min(1, dur > 0 ? local / dur : 1);
}

/** Где карта находится при прогрессе p (0..1). */
export function shufflePose(f: ShuffleFlightShape, p: number): ShufflePose {
  const u = easeOutQuad(p); // база едет из старого места в новое
  const arc = Math.sin(Math.PI * p); // 0 → 1 (апекс) → 0
  return {
    x: lerp(f.from.x, f.to.x, u) + f.bulge * arc,
    y: lerp(f.from.y, f.to.y, u) - f.lift * arc,
    rot: lerp(f.from.rot, f.to.rot, u) + f.lean * arc,
  };
}

/**
 * Пора ли переставить карту в новый z-порядок. Делаем это в ЕЁ апексе: карта приподнята
 * над слотом и вынесена вбок, там перещёлк не читается как подмена карты на месте.
 */
export function shouldSwapZ(p: number): boolean {
  return p >= 0.5;
}
