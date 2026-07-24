import type { RoundedRect } from "./layout";
import { PLAY_STACK_FOOTPRINT } from "./playStack";

// Раскладка ИГРАЛЬНОЙ ЗОНЫ — среднего бокса стола. Сервер хранит только состав кучек
// (GameState.play), а где какая окажется на экране, решает эта чистая функция по индексу.
//
// Сетка ДИНАМИЧЕСКАЯ: число колонок не задано, а подбирается — берётся то, при котором
// карта выходит крупнее всего. Порядок уступок при нехватке места ровно такой:
//   1) сжимаем карту — до PLAY_MIN_SCALE и ни пикселем меньше;
//   2) упёрлись в пол — зона начинает прокручиваться по вертикали.
// Наоборот (сначала скролл, потом сжатие) было бы хуже: на десяти кучках игрок листал бы
// стол, хотя всё спокойно помещается чуть мельче.

/** Пол сжатия: мельче карта в зоне не станет, дальше только прокрутка. */
export const PLAY_MIN_SCALE = 0.5;

/** Зазор между ячейками — доля ШИРИНЫ карты, одинаковая по обеим осям. */
const GAP = 0.18;

export interface PlayCell {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface PlayGrid {
  /**
   * Ячейка на каждую кучку зоны, в порядке индексов сервера.
   *
   * Ячейка меряется ГАБАРИТОМ КУЧКИ, а не карты: карты в кучке разъезжаются, и нижняя
   * выпирает за край верхней (см. playStack.ts). Отводить ей ровно карту значило бы, что
   * соседние кучки налезают друг на друга ровно теми краями, ради которых разъезд и
   * сделан. Хит-тест от этого только выигрывает: попасть в кучку легче, чем в карту.
   */
  cells: PlayCell[];
  /**
   * Ячейка «сюда — новая кучка»: следующая свободная. Место под неё резервируется всегда,
   * поэтому сетка считается на count + 1. Без этого на ровно забитой сетке новую кучку
   * негде было бы начать — свободного места на столе физически не осталось бы.
   */
  addCell: PlayCell;
  /** Размер карты в зоне (не ячейки): ячейка шире и выше на габарит разъезда кучки. */
  cardW: number;
  cardH: number;
  cols: number;
  rows: number;
  /** Насколько всего можно прокрутить; 0 — всё влезло и прокрутки нет. */
  scrollMax: number;
}

const EMPTY_CELL: PlayCell = { cx: 0, cy: 0, w: 0, h: 0 };

/**
 * Посчитать сетку зоны.
 *
 * `scrollY` зажимается сюда же, а не вызывающим: предел зависит от того, сколько строк
 * получилось, а это знает только сама раскладка.
 */
export function playGrid(
  zone: RoundedRect,
  cardW: number,
  cardH: number,
  count: number,
  scrollY = 0,
): PlayGrid {
  // В раздаче стол не размечен: зоны нет, и сетки тоже нет (см. dropZones — там же
  // отсутствующий бокс это прямоугольник нулевого размера).
  if (zone.w <= 0 || zone.h <= 0 || cardW <= 0 || cardH <= 0) {
    return { cells: [], addCell: EMPTY_CELL, cardW: 0, cardH: 0, cols: 0, rows: 0, scrollMax: 0 };
  }

  const total = count + 1; // +1 — ячейка «сюда новую»
  // Место кучке отводится по её габариту, а сама карта остаётся картой: сетка считает
  // раскладку в footprint'ах, а наружу отдаёт и то, и другое.
  const fw = cardW * PLAY_STACK_FOOTPRINT.w;
  const fh = cardH * PLAY_STACK_FOOTPRINT.h;
  const { scale, cols } = fitScale(zone, fw, fh, total);
  const w = fw * scale;
  const h = fh * scale;
  const gap = cardW * GAP * scale;
  const rows = Math.ceil(total / cols);

  const contentW = cols * w + gap * (cols + 1);
  const contentH = rows * h + gap * (rows + 1);
  const scrollMax = Math.max(0, contentH - zone.h);
  const dy = Math.min(Math.max(scrollY, 0), scrollMax);

  const left = zone.cx - zone.w / 2 + (zone.w - contentW) / 2 + gap;
  // Пока всё влезает — содержимое стоит по центру зоны; как только появилась прокрутка,
  // оно прижимается к верху, иначе первая строка уезжала бы под крышу бокса.
  const top = scrollMax > 0 ? zone.cy - zone.h / 2 : zone.cy - contentH / 2;

  const cellAt = (i: number): PlayCell => ({
    cx: left + (i % cols) * (w + gap) + w / 2,
    cy: top + gap + Math.floor(i / cols) * (h + gap) + h / 2 - dy,
    w,
    h,
  });

  return {
    cells: Array.from({ length: count }, (_, i) => cellAt(i)),
    addCell: cellAt(count),
    // Размер САМОЙ КАРТЫ, а не ячейки: ячейка больше на габарит разъезда кучки, и
    // рисовать карту по ячейке значило бы раздуть её на пятую часть.
    cardW: cardW * scale,
    cardH: cardH * scale,
    cols,
    rows,
    scrollMax,
  };
}

/**
 * Сколько колонок и какой масштаб. Перебор, а не формула: колонок заведомо мало (десятки),
 * а «лучше» здесь — не гладкая функция, у неё скачки на каждой смене числа строк.
 */
function fitScale(zone: RoundedRect, cellW: number, cellH: number, total: number): { scale: number; cols: number } {
  let best = { scale: 0, cols: 1 };
  for (let cols = 1; cols <= total; cols++) {
    const rows = Math.ceil(total / cols);
    // Ширина строки: cols карт плюс cols+1 зазоров, всё в одном масштабе s. Отсюда
    // предельное s по каждой оси; берём меньшее и не крупнее исходной карты.
    const byW = zone.w / (cols * cellW + GAP * cellW * (cols + 1));
    const byH = zone.h / (rows * cellH + GAP * cellW * (rows + 1));
    const scale = Math.min(byW, byH, 1);
    if (scale > best.scale) best = { scale, cols };
  }
  if (best.scale >= PLAY_MIN_SCALE) return best;

  // Пол сжатия достигнут: масштаб фиксируем, колонок берём столько, сколько влезает в
  // ширину, а лишние строки уходят под прокрутку.
  const scale = PLAY_MIN_SCALE;
  const gap = cellW * GAP * scale;
  const cols = Math.max(1, Math.floor((zone.w - gap) / (cellW * scale + gap)));
  return { scale, cols };
}

/**
 * Какая кучка под точкой. null — палец мимо всех кучек, и это не «ничего»: именно так
 * заявляется НОВАЯ кучка (дроп в пустое место сетки, включая ячейку «сюда новую»).
 */
export function pickPlayCell(grid: PlayGrid, x: number, y: number): number | null {
  const i = grid.cells.findIndex(
    (c) => Math.abs(x - c.cx) <= c.w / 2 && Math.abs(y - c.cy) <= c.h / 2,
  );
  return i < 0 ? null : i;
}
