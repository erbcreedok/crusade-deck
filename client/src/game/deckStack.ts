// Геометрия стопки и её тени. Два допущения на всё:
// 1) ПЕРЕДНЯЯ (верхняя) карта колоды лежит выше и правее, задняя — ниже и левее;
// 2) свет падает СВЕРХУ СПРАВА, поэтому тени уходят вниз-влево — в ту же сторону, куда
//    уходит задняя карта. Иначе объём читается неправильно.
// Чистая математика: движок только рисует по этим числам.

import { anim } from "./anim/config";

export interface Offset {
  dx: number;
  dy: number;
}

// Смещение i-й карты стопки относительно якоря. Стопка ОТЦЕНТРОВАНА: середина колоды
// лежит в якоре, поэтому колода не «уползает» из зоны по мере роста числа карт.
// i = 0 — задняя карта (ниже-левее), i = count-1 — передняя (выше-правее).
// mirrored — колода лежит лицом вверх, то есть её перевернули: сдвиг стопки уходит в
// зеркальную сторону (не вправо, а влево), ровно как у настоящей перевёрнутой пачки.
export function stackOffset(i: number, count: number, mirrored = false): Offset {
  const c = (Math.max(1, count) - 1) / 2;
  const sx = mirrored ? -anim.deck.stackDx : anim.deck.stackDx;
  // +0 нормализует «минус ноль» (важно только для читаемости чисел в тестах/логах).
  return { dx: (i - c) * sx + 0, dy: (i - c) * anim.deck.stackDy + 0 };
}

// Масштаб колоды на столе: она общая и лежит в центре, поэтому крупнее карты в руке.
// Раньше масштабов было три (центр / рука / чужое место) — колоду можно было носить по
// зонам; теперь она всегда в центре.
export function deckScale(): number {
  return anim.deck.centerScale;
}

// Какие карты стопки рисовать «полосками» торцов в блоке колоды. Смещение на карту —
// доли пикселя, поэтому все 52 торца в блок не влезают и сливаются в серое пятно: берём
// подмножество с читаемым шагом minSpacing (в пикселях по диагонали смещения). Верхнюю
// карту не включаем — она рисуется настоящим спрайтом поверх блока.
export function stackStripeIndices(count: number, minSpacing: number): number[] {
  if (count < 2) return [];
  const perCard = Math.hypot(anim.deck.stackDx, anim.deck.stackDy);
  const step = perCard > 0 ? Math.max(1, Math.ceil(minSpacing / perCard)) : 1;
  const out: number[] = [];
  for (let i = 0; i <= count - 2; i += step) out.push(i);
  return out;
}

// Габарит «толщины» колоды: насколько крайние карты разъезжаются друг от друга. По нему
// движок рисует блок колоды и растягивает её хит-зону.
export function stackExtent(count: number): { w: number; h: number } {
  const n = Math.max(0, count - 1);
  return { w: Math.abs(n * anim.deck.stackDx), h: Math.abs(n * anim.deck.stackDy) };
}

// Смещение тени относительно карты. elev — насколько карта приподнята (scale-1): чем выше
// над столом, тем дальше и мягче тень.
export function lightShadowOffset(cardH: number, elev: number): Offset {
  const s = anim.deck.shadow;
  return {
    dx: -cardH * (s.dx + elev * s.dxLift),
    dy: cardH * (s.dy + elev * s.dyLift),
  };
}
