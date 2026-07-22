// Геометрия стопки и её тени. Одно допущение на всё: свет падает СВЕРХУ СПРАВА, поэтому
// стопка «растёт» вниз-влево, и туда же уходят тени — иначе объём читается неправильно.
// Чистая математика: движок только рисует по этим числам.

import { anim } from "./anim/config";

export interface Offset {
  dx: number;
  dy: number;
}

// Смещение i-й карты стопки относительно якоря (0 — нижняя карта, лежит в якоре).
export function stackOffset(i: number): Offset {
  // +0 нормализует «минус ноль» у нижней карты (i=0 при отрицательном шаге).
  return { dx: i * anim.deck.stackDx + 0, dy: i * anim.deck.stackDy + 0 };
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
