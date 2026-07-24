// Поза клича «ГОООООООООУУУ!!!» во времени. Чистая математика: движок только применяет её
// к надписи. Клич ни к какой карте не привязан — он про весь стол, поэтому не отскакивает
// вместе с колодой (в отличие от «низяяя», см. rejectShake), а ПРОЛЕТАЕТ через экран
// справа налево, дрожа на ходу: так он читается как выкрик, а не как всплывающая плашка.

/** Сколько живёт клич, сек. Столько же длится пролёт. */
export const SHOUT_DUR = 1.35;

export interface ShoutPose {
  /**
   * Положение по горизонтали в долях полуэкрана: +1 — только что выехал справа за край,
   * 0 — по центру, −1 — ушёл влево за край. Движок домножает на (полширины + полнадписи),
   * чтобы за краем надпись оказалась целиком.
   */
  x: number;
  /** Дрожание по вертикали в долях кегля. */
  shakeY: number;
  /** Дрожание наклоном, радианы. */
  rot: number;
  scale: number;
  alpha: number;
}

/** Заезд, «зависание» по центру и выезд. Сумма долей = 1. */
const ENTER = 0.28;
const HANG = 0.3;
/** Насколько далеко за край улетает надпись (в долях полуэкрана). */
const OFFSCREEN = 1.2;
/** Докуда доезжает на заезде и откуда стартует выезд: короткий проход через центр. */
const HANG_X = 0.14;

/** Частоты дрожания: по вертикали чаще, наклоном — реже, иначе рябит. */
const SHAKE_FREQ = 11;
const ROT_FREQ = 6.5;
const SHAKE_AMP = 0.16;
const ROT_AMP = 0.07;

const START_SCALE = 0.55;
export const SHOUT_PEAK_SCALE = 1.3;

/** Средняя ширина буквы пиксельного шрифта в долях кегля (та же прикидка, что у подписей зон). */
const GLYPH_W = 0.62;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (x: number) => 1 - (1 - x) * (1 - x) * (1 - x);
const easeIn = (x: number) => x * x * x;

export function shoutPose(progress: number): ShoutPose {
  const p = clamp01(progress);

  // Пролёт: влетает быстро, у центра почти замирает (успеть прочитать), затем срывается
  // и уходит влево. Скорость задаётся кривой на каждом участке, а не одной общей — с
  // равномерным движением клич читается как титр, а не как выкрик.
  let x: number;
  if (p < ENTER) x = OFFSCREEN - (OFFSCREEN - HANG_X) * easeOut(p / ENTER);
  else if (p < ENTER + HANG) x = HANG_X - 2 * HANG_X * ((p - ENTER) / HANG);
  else x = -HANG_X - (OFFSCREEN - HANG_X) * easeIn((p - ENTER - HANG) / (1 - ENTER - HANG));

  // Дрожь живёт весь пролёт и слегка усиливается к центру — там надпись «орёт» громче.
  const loud = 0.6 + 0.4 * Math.sin(Math.PI * p);
  const shakeY = Math.sin(p * Math.PI * 2 * SHAKE_FREQ) * SHAKE_AMP * loud;
  const rot = Math.sin(p * Math.PI * 2 * ROT_FREQ + 1) * ROT_AMP * loud;

  // Удар на въезде: мелкая надпись стремительно вырастает С ПЕРЕХЛЁСТОМ и оседает.
  // Дальше — лёгкая пульсация в такт дрожи.
  const punch =
    p < ENTER
      ? START_SCALE + (SHOUT_PEAK_SCALE - START_SCALE) * easeOut(p / ENTER)
      : 1 + (SHOUT_PEAK_SCALE - 1) * Math.max(0, 1 - (p - ENTER) / 0.12);
  const scale = punch + 0.04 * Math.sin(p * Math.PI * 2 * SHAKE_FREQ) * loud;

  // Гаснет только у самого края — основную дорогу клич едет непрозрачным.
  const alpha = p < 0.05 ? p / 0.05 : p > 0.9 ? (1 - p) / 0.1 : 1;

  return { x, shakeY, rot, scale, alpha: clamp01(alpha) };
}

/**
 * Кегль клича по ширине экрана. Меряем прикидкой, а не реальным Text: раскладка нужна
 * ещё до первого кадра.
 */
export function shoutFontSize(screenW: number, textLength: number): number {
  if (screenW <= 0 || textLength <= 0) return 24;
  // Слово плюс два огонька по бокам (см. shoutEmojiOffset — по 0.7 кегля на каждый).
  // Целимся в спокойный масштаб: на «ударе» надпись специально шире экрана — это пик
  // въезда, она в этот момент и так уходит за край, а читают её у центра, где scale ≈ 1.
  const fit = (screenW * 0.92) / (textLength * GLYPH_W + 1.4);
  return Math.max(20, Math.min(96, fit));
}

/** Насколько огоньки отступают от центра: полслова плюс воздух. */
export function shoutEmojiOffset(fontSize: number, textLength: number): number {
  return (textLength * GLYPH_W * fontSize) / 2 + fontSize * 0.7;
}
