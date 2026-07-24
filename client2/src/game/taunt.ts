// Кричалки — надписи, которые игрок швыряет на стол кнопкой. Состояния в них нет
// (сервер их не интерпретирует, см. server/src/taunt.ts), поэтому здесь ровно одно:
// КАК надпись выглядит во времени. Движок только применяет позу к тексту.
//
// Кричалок две, и они нарочно разной природы:
//   gkh  — «гхх гхх гхх»: личная. Вылетает ИЗ МЕСТА того, кто нажал (себе — снизу, из
//          своей руки), и трясётся: это кашель конкретного человека, а не объявление.
//   suck — «сосааааать»: общая. Всем одинаково из центра стола, без тряски — она про
//          весь стол сразу, поэтому у неё нет источника и нечему дрожать.

export const TAUNT_KINDS = ["gkh", "suck"] as const;
export type TauntKind = (typeof TAUNT_KINDS)[number];

export const TAUNT_TEXT: Record<TauntKind, string> = {
  gkh: "гхх гхх гхх",
  suck: "сосааааать",
};

/** Подписи кнопок панели. Короткие: кнопка узкая, длинное режется (см. ActionBar). */
export const TAUNT_LABEL: Record<TauntKind, string> = {
  gkh: "соснуть",
  suck: "сосать",
};

/** Сколько живёт кричалка, сек. */
export const TAUNT_DUR: Record<TauntKind, number> = {
  gkh: 1.5,
  suck: 1.8,
};

/** Цвета: кашель — болезненно-зелёный, общий вопль — тот же огонь, что у «ГОУ!». */
export const TAUNT_COLORS: Record<TauntKind, { fill: number; stroke: number }> = {
  gkh: { fill: 0xb8d977, stroke: 0x24380f },
  suck: { fill: 0xffc233, stroke: 0x7d1b06 },
};

/** Средняя ширина буквы пиксельного шрифта в долях кегля (та же прикидка, что у кличей). */
const GLYPH_W = 0.62;
/** Поля по краям экрана: надпись не должна упираться в кромку. */
const SIDE_MARGIN = 0.9;
/** Наибольший масштаб позы — в него кегль и должен влезать (см. tauntPose). */
const PEAK_SCALE: Record<TauntKind, number> = { gkh: 1.1, suck: 1.2 };

/**
 * Кегль кричалки: такой, чтобы в САМЫЙ крупный кадр надпись целиком влезала в экран.
 * Считается от ширины, а не берётся константой, — иначе на узком телефоне длинное
 * «сосааааать» уезжает за оба края и читается кусками.
 */
export function tauntFontSize(screenW: number, kind: TauntKind): number {
  const chars = Math.max(1, TAUNT_TEXT[kind].length);
  const fit = (screenW * SIDE_MARGIN) / (chars * GLYPH_W * PEAK_SCALE[kind]);
  // Потолок — как у клича (см. engine/shout.ts): на широком мониторе кричалка должна
  // орать так же громко, а не съёживаться в подпись под столом.
  return Math.max(14, Math.min(96, fit));
}

export interface TauntPose {
  /** Смещение от точки-источника, в долях кегля. */
  dx: number;
  dy: number;
  /** Наклон, радианы. */
  rot: number;
  scale: number;
  alpha: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (x: number) => 1 - (1 - x) * (1 - x) * (1 - x);

/** Частоты тряски: по вертикали чаще, наклоном реже — иначе надпись рябит, а не дрожит. */
const SHAKE_FREQ = 17;
const ROT_FREQ = 9;
const SHAKE_AMP = 0.1;
const ROT_AMP = 0.06;

/** Насколько кашель всплывает над местом за свою жизнь, в долях кегля. */
const GKH_RISE = 1.1;
/** Доля жизни на проявление и на угасание — общая для обеих кричалок. */
const FADE_IN = 0.15;
const FADE_OUT = 0.3;

function fade(p: number): number {
  if (p < FADE_IN) return p / FADE_IN;
  if (p > 1 - FADE_OUT) return (1 - p) / FADE_OUT;
  return 1;
}

export function tauntPose(kind: TauntKind, progress: number): TauntPose {
  const p = clamp01(progress);
  const alpha = clamp01(fade(p));

  if (kind === "gkh") {
    // Всплывает над местом и трясётся всю дорогу: кашель не «выезжает», а колотит.
    return {
      dx: SHAKE_AMP * Math.sin(2 * Math.PI * SHAKE_FREQ * p),
      dy: -GKH_RISE * easeOut(p) + SHAKE_AMP * Math.sin(2 * Math.PI * SHAKE_FREQ * p * 1.3),
      rot: ROT_AMP * Math.sin(2 * Math.PI * ROT_FREQ * p),
      scale: 0.85 + 0.25 * easeOut(p),
      alpha,
    };
  }

  // Общая кричалка: раздувается из центра и замирает. Тряски нет — она одна на всех,
  // и дрожать ей не от чего.
  return { dx: 0, dy: 0, rot: 0, scale: 0.5 + 0.7 * easeOut(p), alpha };
}
