import type { PlayGrid } from "./playGrid";

// Куда именно уедет карта, если отпустить палец ЗДЕСЬ.
//
// Кучки в сетке лежат плотно, и по одному силуэту карты под пальцем не понять, попадёшь ты
// в неё или начнёшь новую рядом. Подсветкой рамкой тут не отделаться: карта в драге сама
// накрывает ту кучку, к которой примеривается. Поэтому стол ОТВЕЧАЕТ движением —
// наведённая кучка приподнимается (и её тень уходит дальше, потому что тень считается от
// подъёма), а соседи отступают, открывая её края.
//
// Чистая функция: движок только применяет числа к целям своих карт.

/** Насколько подрастает кучка под пальцем. Заметно, но не «карта прыгнула в лицо». */
const HOVER_SCALE = 1.14;
/** Подъём наведённой кучки — в долях высоты карты. */
const HOVER_LIFT = 0.12;
/** Отступ соседа — в долях его размера. */
const PUSH = 0.3;
/**
 * За сколько «карт» отступ сходит на нет. Расстояние меряется в размерах КАРТЫ по каждой
 * оси отдельно, поэтому у соседа через одну ячейку получается около 1, у следующего — 2:
 * отступают ровно ближайшие, дальний ряд стоит на месте и не создаёт волны по всему столу.
 */
const FALLOFF = 2.4;

export interface HoverAdjust {
  dx: number;
  dy: number;
  /** Множитель к масштабу карт кучки. */
  scale: number;
}

const NONE: HoverAdjust = { dx: 0, dy: 0, scale: 1 };

/**
 * Поправка к месту кучки `index`, когда палец наводится на кучку `hovered`.
 *
 * `hovered === null` (или указывает в пустоту) — стол стоит как стоял.
 */
export function playHoverAdjust(grid: PlayGrid, hovered: number | null, index: number): HoverAdjust {
  if (hovered === null) return NONE;
  const at = grid.cells[hovered];
  const me = grid.cells[index];
  if (!at || !me) return NONE;
  if (index === hovered) return { dx: 0, dy: -grid.cardH * HOVER_LIFT, scale: HOVER_SCALE };

  // Расстояние нормируем по размеру карты — иначе на широкой сетке соседи по горизонтали
  // считались бы «дальше», чем соседи по вертикали, хотя на глаз они одинаково рядом.
  const nx = (me.cx - at.cx) / Math.max(1, grid.cardW);
  const ny = (me.cy - at.cy) / Math.max(1, grid.cardH);
  const d = Math.hypot(nx, ny);
  if (d === 0) return NONE; // две кучки в одной точке — двигать некуда
  const falloff = Math.max(0, 1 - d / FALLOFF);
  if (falloff === 0) return NONE;
  const push = PUSH * falloff;
  return { dx: (nx / d) * grid.cardW * push, dy: (ny / d) * grid.cardH * push, scale: 1 };
}
