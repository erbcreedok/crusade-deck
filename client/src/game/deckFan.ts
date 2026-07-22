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

export function layoutDeckFan(args: DeckFanArgs): DeckFanGeom {
  const { stackAnchor: a, zone: z, count, cardW } = args;
  const anchor = { x: a.x, y: a.y };
  const angleDeg = fanMaxAngleDeg(count, anim.fan.maxAngleDeg, anim.fan.maxStepAngleDeg);
  // Ширина — почти вся зона центра; clampFanWidth подрежет шаг при малом count.
  const fit = z.w * 0.92;
  const width = clampFanWidth(fit, count, cardW, anim.fan.widthFactor, anim.fan.maxStepIdle);
  return { anchor, width, angleDeg };
}
