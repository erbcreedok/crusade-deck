import { anim } from "../anim/config";
import { isSwipeDown, swipeStrength, type SwipeSample } from "../swipeShuffle";
import { DRAG_THRESHOLD } from "./constants";

// Что игрок ИМЕЕТ В ВИДУ, ведя пальцем по вееру. Один и тот же жест значит разное: бросок
// вверх — «перемешай», бросок вниз по руке — «сложи», медленное ведение — «раздвинь веер
// под пальцем» (глиссандо), движение с уже видимой карты — «возьми её».
//
// Правила вынесены из движка отдельно: их семь штук, они взаимно исключающие и именно
// здесь легко ошибиться — например, принять медленное ведение за свайп и тасануть колоду
// посреди разглядывания карт.

/** Сколько последних точек храним для оценки скорости (окно, а не две точки). */
export const SAMPLE_LIMIT = 12;

/** Добавить точку в историю движения, выбросив самую старую. */
export function pushSample(samples: SwipeSample[], sample: SwipeSample): void {
  samples.push(sample);
  if (samples.length > SAMPLE_LIMIT) samples.shift();
}

/** Палец сдвинулся достаточно, чтобы это был жест, а не тап. */
export function movedEnough(dx: number, dy: number): boolean {
  return dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD;
}

/**
 * Свайп ВВЕРХ: быстрое движение с весомой вертикальной составляющей вверх. Наклон вбок
 * допускаем (он задаёт сторону разлёта) — не пускаем только движения вниз и
 * «горизонтальные протяжки», которые на деле глиссандо.
 *
 * Путь вверх обязателен: он отсекает медленное ведение и мелкое дрожание пальца, на
 * которых одна только скорость иногда даёт ложный свайп.
 */
export function isSwipeUp(vx: number, vy: number, travelUp: number, cardH: number): boolean {
  if (vy >= 0) return false; // вниз — не тот жест
  if (-vy < Math.abs(vx) * anim.swipe.upBias) return false; // почти горизонтально — не свайп
  if (travelUp < cardH * anim.swipe.minTravel) return false;
  return swipeStrength(vx, vy) > 0;
}

/** Свайп ВНИЗ по вееру руки — «сложить руку». По колоде так нельзя (её сворачивает стрелка). */
export function isCollapseSwipe(vx: number, vy: number, travelDown: number, cardH: number): boolean {
  return isSwipeDown(vx, vy) && travelDown >= cardH * anim.swipe.minTravel;
}

export interface PressContext {
  /** Смещение пальца от точки нажатия. */
  dx: number;
  dy: number;
  /** Скорость по окну последних точек. */
  vx: number;
  vy: number;
  /** Пройдено вверх / вниз от точки нажатия (положительные числа). */
  travelUp: number;
  travelDown: number;
  cardH: number;
  /** Жест начался на руке (иначе — на колоде). */
  fromHand: boolean;
  /** Есть что сворачивать: рука раскрыта веером. У сложенной шеренги свайп вниз — драг. */
  canCollapse: boolean;
  /** Это перетаскивание верхней карты на раздачу. */
  dealDrag: boolean;
  /** На момент нажатия карта была видна достаточно, чтобы её схватить. */
  canGrab: boolean;
  /** Веер раскрыт и карт в нём хотя бы две — только тогда свайп вверх что-то значит. */
  swipeable: boolean;
  /** Этот игрок может тасовать колоду (дилер в раздаче или кто угодно вне её). */
  canShuffle: boolean;
}

export type PressIntent =
  /** Ещё не жест: палец почти не сдвинулся. */
  | "wait"
  /** Раздача: тащим верхнюю карту. */
  | "deal"
  /** Сложить свою руку. */
  | "collapse-hand"
  /** Перемешать колоду выплеском. */
  | "shuffle"
  /** Ведение по зажатому вееру: раскрытие едет за пальцем. */
  | "glissando"
  /** Взять карту из веера. */
  | "grab";

export function pressIntent(c: PressContext): PressIntent {
  if (!movedEnough(c.dx, c.dy)) return "wait";
  // Раздача/взятие: со стопки (canGrab всегда true) — сразу в драг. Но из РАСКРЫТОГО веера
  // тесную карту сначала раздвигаем глиссандо, как в руке, — веер везде ведёт себя
  // одинаково. canGrab уже учитывает, широкая ли полоска у карты под пальцем.
  if (c.dealDrag) return c.canGrab ? "deal" : "glissando";
  if (c.fromHand && c.canCollapse && isCollapseSwipe(c.vx, c.vy, c.travelDown, c.cardH)) {
    return "collapse-hand";
  }

  if (c.swipeable && isSwipeUp(c.vx, c.vy, c.travelUp, c.cardH) && !c.fromHand) {
    // Тасовать может не каждый: не-дилер в раздаче просто продолжает глиссандо.
    return c.canShuffle ? "shuffle" : "glissando";
  }
  // Захват МГНОВЕННЫЙ: ждём не время удержания, а само движение. Если веер был зажат и
  // хватать нечего — ведение раскрывает его под пальцем, как глиссандо по клавишам.
  return c.canGrab ? "grab" : "glissando";
}
