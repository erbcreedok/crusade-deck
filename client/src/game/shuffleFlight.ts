// Параметры полёта одной карты в настоящей растасовке. Чистая математика — тестируется
// юнитами, движок только проигрывает эти числа.
//
// Зачем пол по времени/подъёму/выносу: спрайты привязаны к идентичности карты
// (reconcileByIdentity — аналог key={id} в React), но раньше карта с малой дельтой
// |new-old| летела ~0.14с на 12% высоты карты. В стопке (видна только верхняя) и в тесном
// веере (видна полоска 6–20px) такое смещение не читается как перелёт — виден лишь
// перещёлк z-порядка, и выглядит это как «карта превратилась в другую». Поэтому у каждой
// карты есть минимальный ЗАМЕТНЫЙ полёт, а боковой вынос тем больше, чем меньше дельта:
// дальним картам перелёт показывает сама траектория, ближним — показывать нечем.

import { anim } from "./anim/config";

export interface Flight {
  delay: number; // сдвиг старта (каскад по колоде), сек
  dur: number; // длительность полёта, сек
  lift: number; // высота дуги, px
  bulge: number; // боковой вынос на апексе, px
  lean: number; // крен в сторону выноса, рад
}

// nd — нормированная дельта позиции 0..1, order — место карты в каскаде (0..count-1).
export function shuffleFlight(nd: number, order: number, count: number, cardH: number, cardW: number): Flight {
  const f = anim.shuffle.flight;
  const d = clamp01(nd);
  return {
    delay: count > 1 ? f.stagger * clamp01(order / (count - 1)) : 0,
    dur: lerp(f.durMin, f.durMax, d),
    lift: cardH * lerp(f.liftMin, f.liftMax, d),
    bulge: cardW * lerp(f.bulgeMax, f.bulgeMin, d), // ближним — больше (см. комментарий выше)
    lean: lerp(f.leanMin, f.leanMax, d),
  };
}

// В какую сторону вынести карту на апексе. Если она и так заметно едет по горизонтали —
// в сторону движения. Если почти на месте (стопка) — чередуем стороны по индексу, чтобы
// колода расходилась в обе стороны, как при риффле, а не пульсировала одним комком.
export function bulgeDir(dx: number, cardW: number, index: number): 1 | -1 {
  if (Math.abs(dx) > cardW * 0.5) return dx > 0 ? 1 : -1;
  return index % 2 === 0 ? -1 : 1;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
