// Свайп по вееру вверх = «перемешать»: из колоды выплёскивается несколько карт, они
// разлетаются в стороны и возвращаются. Чистая математика жеста — движок только рисует.

import { anim } from "./anim/config";

export interface Dir {
  dx: number;
  dy: number;
}

export interface SwipeSample {
  x: number;
  y: number;
  t: number; // мс
}

// Скорость пальца по ОКНУ последних выборок (px/с), а не по последней паре событий:
// иначе одиночный рывок в конце медленного ведения читается как свайп. Берём крайние
// выборки внутри окна — это средняя скорость за окно, шум одного кадра в неё не пролезает.
export function swipeVelocity(samples: readonly SwipeSample[], windowMs: number): { vx: number; vy: number } {
  if (samples.length < 2) return { vx: 0, vy: 0 };
  const last = samples[samples.length - 1];
  let first = last;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (last.t - samples[i].t > windowMs) break;
    first = samples[i];
  }
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

// Какие карты выплеснуть: НЕПРЕРЫВНЫЙ участок вокруг той карты, с которой начался свайп —
// «взял пачку из этого места колоды», а не выдернул карты по всему вееру. У края колоды
// участок сдвигается внутрь, сохраняя количество.
export function swipeCardIndices(startIndex: number, count: number, deckCount: number): number[] {
  const n = Math.min(Math.max(0, count), Math.max(0, deckCount));
  if (n <= 0) return [];
  const half = Math.floor(n / 2);
  const from = Math.max(0, Math.min(deckCount - n, startIndex - half));
  return Array.from({ length: n }, (_, k) => from + k);
}

// Сила свайпа 0..1 по ПОЛНОЙ скорости пальца (px/с): ниже minSpeed — жеста нет, выше
// maxSpeed — сильнее уже некуда.
export function swipeStrength(vx: number, vy: number): number {
  const s = anim.swipe;
  const speed = Math.hypot(vx, vy);
  if (speed <= s.minSpeed) return 0;
  return Math.min(1, (speed - s.minSpeed) / Math.max(1, s.maxSpeed - s.minSpeed));
}

// Сколько карт выплеснуть: от minCards при слабом свайпе до maxCards при сильном.
export function swipeCardCount(strength: number): number {
  const s = anim.swipe;
  const t = Math.max(0, Math.min(1, strength));
  return Math.round(s.minCards + (s.maxCards - s.minCards) * t);
}

// Направления разлёта: сектор, отцентрованный по направлению свайпа. Чем сильнее свайп
// завален вбок, тем УЖЕ сектор — карты уходят кучнее в ту сторону, а не веером во все.
// Раскладка равномерная (не случайная): так разлёт читается как «в разные стороны» и
// при этом воспроизводим в тестах.
export function swipeDirections(count: number, vx: number, vy: number): Dir[] {
  if (count <= 0) return [];
  const s = anim.swipe;
  const speed = Math.hypot(vx, vy);
  const center = speed > 0 ? Math.atan2(vy, vx) : -Math.PI / 2; // нет скорости — вверх
  const tilt = speed > 0 ? Math.abs(vx) / speed : 0; // 0 — строго вверх, 1 — вбок
  const half = s.spreadWide + (s.spreadTight - s.spreadWide) * tilt;
  const out: Dir[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1); // 0..1 по сектору
    const a = center + (t * 2 - 1) * half;
    out.push({ dx: Math.cos(a), dy: Math.sin(a) });
  }
  return out;
}

// Свайп ВНИЗ: им складывают руку (выход из фокуса) и прерывают драг карты. Сектор широкий,
// диагонали вниз тоже считаются, а горизонтальное ведение — нет: это глиссандо по вееру.
export function isSwipeDown(vx: number, vy: number): boolean {
  const speed = Math.hypot(vx, vy);
  if (speed < anim.flip.minSwipeSpeed) return false;
  return vy / speed > anim.flip.upSectorCos;
}
