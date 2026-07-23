// Геометрия веера КОЛОДЫ в центре стола.
// Не путать с веером руки: там якорь у ВЕРХА полосы (карта + провис + кнопка снизу).
// Здесь якорь = якорь стопки — веер раскрывается на месте колоды, рядом со счётчиком.
//
// Ширину берём от зоны, а не от «бюджета провиса вниз»: якорь в центре, снизу мало места,
// и Math.max(1, sagBudget) раньше давал веер ~8px при ±30° — визуально спираль.

import { anim } from "./anim/config";
import { clampFanWidth, fanMaxAngleDeg } from "./fan";

export interface DeckFanGeom {
  anchor: { x: number; y: number };
  width: number;
  angleDeg: number;
}

export interface DeckFanArgs {
  stackAnchor: { x: number; y: number };
  zone: { cx: number; cy: number; w: number; h: number };
  count: number;
  cardW: number;
  cardH: number;
  /** Зарезервировано под счётчик/стрелку; на ширину веера не влияет. */
  reservedBelow?: number;
}

/**
 * Размер карты в РАСКРЫТОМ вееере — хоть на доске, хоть в руке.
 *
 * Эталон стола — карта в закрытой руке (масштаб 1): так выглядят все стопки и почти все
 * карты. Раскрытый веер — то, на что игрок смотрит прямо сейчас, поэтому его карты чуть
 * крупнее эталона. Ширину веера это НЕ определяет: сколько бы карт ни было, они одного
 * размера, а тесноту разруливает шаг между ними (clampFanWidth).
 *
 * Исключение — большие вееры: с полусотней карт крупный шрифт просто некуда девать, и
 * карты плавно ужимаются обратно к эталону.
 */
export function fanCardScale(count: number): number {
  if (count <= DENSE_FROM) return FAN_SCALE;
  const t = Math.min(1, (count - DENSE_FROM) / (FULL_DECK - DENSE_FROM));
  return FAN_SCALE - t * (FAN_SCALE - DENSE_SCALE);
}

/** Во сколько раз карта раскрытого веера крупнее карты закрытой руки. */
export const FAN_SCALE = 1.2;
/** С этого числа карт веер начинает ужиматься. */
const DENSE_FROM = 18;
/** Куда ужимается на полной колоде. */
const DENSE_SCALE = 0.95;
const FULL_DECK = 52;

export function layoutDeckFan(args: DeckFanArgs): DeckFanGeom {
  const { stackAnchor: a, zone: z, count, cardW } = args;
  const anchor = { x: a.x, y: a.y };
  const angleDeg = fanMaxAngleDeg(count, anim.fan.maxAngleDeg, anim.fan.maxStepAngleDeg);
  // Ширина ДУГИ, а не всего веера: крайние карты торчат за её концы ещё на полкарты в
  // каждую сторону. Поэтому из зоны сразу вычитаем карту — иначе веер свисает за край
  // стола (а в игре — за край экрана).
  const fit = Math.max(cardW, z.w - cardW);
  const width = clampFanWidth(fit, count, cardW, anim.fan.widthFactor, anim.fan.maxStepIdle);
  return { anchor, width, angleDeg };
}
