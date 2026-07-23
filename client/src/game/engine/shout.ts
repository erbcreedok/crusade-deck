// Поза клича «ГОООООУУУ!!!» во времени. Чистая математика: движок только применяет её к
// надписи. Клич ни к какой карте не привязан — он про весь стол, поэтому у него нет ни
// отскока, ни тряски (в отличие от «низяяя», см. rejectShake).

/** Сколько живёт клич, сек. */
export const SHOUT_DUR = 1.1;

export interface ShoutPose {
  scale: number;
  alpha: number;
}

/** Доля времени, за которую надпись «прилетает» в кадр. */
const PUNCH = 0.18;
/** Доля времени на оседание после перехлёста. */
const SETTLE = 0.25;
/** Проявление и начало затухания. */
const FADE_IN = 0.06;
const FADE_OUT_FROM = 0.65;

const START_SCALE = 0.35;
/** Насколько надпись перехлёстывает свой размер на «ударе» — по нему считается и запас по ширине. */
export const SHOUT_PEAK_SCALE = 1.28;
const PEAK_SCALE = SHOUT_PEAK_SCALE;

/** Средняя ширина буквы пиксельного шрифта в долях кегля (та же прикидка, что у подписей зон). */
const GLYPH_W = 0.62;

/**
 * Кегль клича по ширине экрана. Меряем прикидкой, а не реальным Text: раскладка нужна ещё
 * до первого кадра, а на узком телефоне надпись обязана влезть ВМЕСТЕ с перехлёстом удара
 * — иначе на пике она уезжает за края.
 */
export function shoutFontSize(screenW: number, textLength: number): number {
  if (screenW <= 0 || textLength <= 0) return 24;
  // Слово плюс два огонька по бокам — примерно полторы ширины слова.
  const fit = (screenW * 0.9) / (textLength * GLYPH_W * PEAK_SCALE * 1.5);
  return Math.max(24, Math.min(96, fit));
}

/** Насколько огоньки отступают от центра: полслова плюс воздух. */
export function shoutEmojiOffset(fontSize: number, textLength: number): number {
  return (textLength * GLYPH_W * fontSize) / 2 + fontSize * 0.7;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (x: number) => 1 - (1 - x) * (1 - x) * (1 - x);

export function shoutPose(progress: number): ShoutPose {
  const p = clamp01(progress);

  // Удар: мелкая надпись стремительно вырастает С ПЕРЕХЛЁСТОМ и лишь потом оседает в свой
  // размер. Без перехлёста появление читается как «проявилась», а нужен именно выкрик.
  const scale =
    p < PUNCH
      ? START_SCALE + (PEAK_SCALE - START_SCALE) * easeOut(p / PUNCH)
      : PEAK_SCALE - (PEAK_SCALE - 1) * easeOut(Math.min(1, (p - PUNCH) / SETTLE));

  const alpha =
    p < FADE_IN
      ? p / FADE_IN
      : p < FADE_OUT_FROM
        ? 1
        : 1 - (p - FADE_OUT_FROM) / (1 - FADE_OUT_FROM);

  return { scale, alpha: clamp01(alpha) };
}
