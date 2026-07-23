import type { RoundedRect } from "./layout";

// Посадка чужих игроков буквой «П».
//
// Правило одно и оно про СОСЕДЕЙ: по каждому боку сидит максимум один человек, и это
// всегда непосредственный сосед по кругу — того, кто ходит до тебя и после тебя, ты
// обязан видеть рядом с собой, а не искать в общей полосе. Поэтому боковых мест либо
// НОЛЬ, либо ровно два: одно слева, одно справа. Всё остальное — верхняя полоса.
//
// Боковые появляются только тогда, когда в полосу перестало влезать: пока весь стол
// умещается в один ряд, «П» вырождается в «—», и это правильно — иначе по углам экрана
// остаются пустые дыры, а полоса зря жмётся к середине.
//
// Когда людей больше, чем влезает даже в тесную полосу, полоса ПРОКРУЧИВАЕТСЯ по
// горизонтали. Соседи по бокам при этом не двигаются: они закреплены, и увести их из
// поля зрения прокруткой нельзя — в этом весь их смысл.
//
// Место игрока — прямоугольник. Он же его дроп-зона (см. dropZones.ts): бросок колоды
// на игрока = отдать колоду ему. Поэтому здесь только геометрия, без отрисовки.

export type SeatSide = "top" | "left" | "right";

export interface SeatBox {
  id: string; // sessionId живого игрока или id бота
  side: SeatSide;
  rect: RoundedRect;
}

export interface SeatInsets {
  /** Сколько по вертикали занято верхней полосой (0 — её нет). */
  top: number;
  /** Сколько по вертикали занимают боковые места (0 — их нет). */
  side: number;
}

export interface SeatsLayout {
  seats: SeatBox[];
  insets: SeatInsets;
  /**
   * Насколько верхняя полоса длиннее экрана. 0 — влезла целиком, прокрутки нет.
   * Движок держит у себя смещение и не даёт увести его за эти границы.
   */
  topScrollMax: number;
}

/** Комфортная ширина места: имя и счётчик карт читаются без прищура. */
export const SEAT_MIN_W = 72;
/** До этой ширины полоса ужимается молча. Уже — включается прокрутка. */
export const SEAT_TIGHT_W = 56;

const SEAT_R = 12;
const GAP = 6; // зазор между местами, чтобы рамки не сливались

export interface SeatLayoutOptions {
  // Сколько сверху занято HTML-топбаром комнаты (код/приват/сводка/меню). Места
  // начинаются под ним: канвас лежит во весь экран, а топбар рисуется поверх него.
  topOffset?: number;
  /** Текущее смещение прокрутки верхней полосы, px. Клампится здесь же. */
  scrollX?: number;
}

/** Влезают ли все в один ряд, не залезая в бока. */
export function fitsInOneRow(count: number, w: number): boolean {
  return count * SEAT_MIN_W <= w;
}

export function layoutSeats(
  ids: string[],
  w: number,
  h: number,
  opts: SeatLayoutOptions = {},
): SeatsLayout {
  const empty: SeatsLayout = { seats: [], insets: { top: 0, side: 0 }, topScrollMax: 0 };
  if (ids.length === 0) return empty;

  const seatH = clamp(h * 0.13, 52, 104);
  const colW = clamp(w * 0.22, SEAT_MIN_W, 150);
  const sideH = clamp(h * 0.17, 64, 130);
  // Топбар не должен «съесть» всю посадку: на очень низком экране ограничиваем его вклад.
  const top0 = clamp(opts.topOffset ?? 0, 0, h * 0.3);

  // Боковые нужны, только если ряд уже не держит всех. Меньше трёх человек в бока не
  // сажаем никогда: иначе верхняя полоса опустеет, а «П» превратится в две колонки.
  const useSides = ids.length >= 3 && !fitsInOneRow(ids.length, w);
  // Соседи — первый и последний по кругу (список идёт от следующего за мной по часовой).
  // Слева садится следующий, справа — предыдущий: так круг читается непрерывно —
  // я внизу → левый бок → полоса слева направо → правый бок → снова я.
  const leftId = useSides ? ids[0] : null;
  const rightId = useSides ? ids[ids.length - 1] : null;
  const topIds = useSides ? ids.slice(1, -1) : ids;

  const seats: SeatBox[] = [];

  // Верхняя полоса идёт во ВСЮ ширину экрана: боковые сидят под ней, а не рядом с ней,
  // и потому её не поджимают. Ячейка ужимается до тесной ширины, дальше — прокрутка.
  const rawCellW = topIds.length > 0 ? w / topIds.length : 0;
  const cellW = topIds.length > 0 ? Math.max(SEAT_TIGHT_W, rawCellW) : 0;
  const topScrollMax = Math.max(0, cellW * topIds.length - w);
  const scrollX = clamp(opts.scrollX ?? 0, 0, topScrollMax);

  topIds.forEach((id, i) => {
    seats.push({
      id,
      side: "top",
      rect: {
        cx: cellW * (i + 0.5) - scrollX,
        cy: top0 + seatH / 2,
        w: Math.max(1, cellW - GAP),
        h: Math.max(1, seatH - GAP),
        r: SEAT_R,
      },
    });
  });

  const insets: SeatInsets = {
    top: topIds.length > 0 ? top0 + seatH : 0,
    side: useSides ? sideH : 0,
  };

  // Боковые: по одному в верхних углах, сразу под полосой. Стол они НЕ сужают — вместо
  // этого им уступают по вертикали колода и сброс (см. computeLayout), иначе на узком
  // экране игровая зона схлопывалась бы в щель.
  const sideTop = topIds.length > 0 ? insets.top : top0;
  const sideRect = (cx: number): RoundedRect => ({
    cx,
    cy: sideTop + sideH / 2,
    w: Math.max(1, colW - GAP),
    h: Math.max(1, sideH - GAP),
    r: SEAT_R,
  });
  if (leftId) seats.push({ id: leftId, side: "left", rect: sideRect(colW / 2) });
  if (rightId) seats.push({ id: rightId, side: "right", rect: sideRect(w - colW / 2) });

  return { seats, insets, topScrollMax };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
