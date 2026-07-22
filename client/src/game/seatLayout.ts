import type { RoundedRect } from "./layout";

// Посадка чужих игроков буквой «П»: сначала полоса поверху, слева направо; кто не
// влез — сползает в боковые колонки (сначала правую, потом левую). Боковые ужимают
// центр стола по ширине — это и есть смысл «П»: стол сужается, но места не налезают
// друг на друга и не уходят за экран.
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
  top: number; // сколько по вертикали занято верхней полосой
  left: number; // ширина левой колонки (0, если её нет)
  right: number;
}

export interface SeatsLayout {
  seats: SeatBox[];
  insets: SeatInsets;
}

// Уже этой ширины место не имеет смысла: имя и счётчик карт перестают читаться.
export const SEAT_MIN_W = 96;

const SEAT_R = 12;
const GAP = 6; // зазор между местами, чтобы рамки не сливались

// Верхняя полоса и боковые колонки живут в верхних ~62% экрана: ниже начинаются мои
// сейф-зона и рука (см. computeLayout) — туда чужие места залезать не должны.
const SEATS_AREA_H = 0.62;

export interface SeatLayoutOptions {
  // Сколько сверху занято HTML-топбаром комнаты (код/приват/сводка/меню). Места
  // начинаются под ним: канвас лежит во весь экран, а топбар рисуется поверх него.
  topOffset?: number;
}

export function layoutSeats(
  ids: string[],
  w: number,
  h: number,
  opts: SeatLayoutOptions = {},
): SeatsLayout {
  if (ids.length === 0) return { seats: [], insets: { top: 0, left: 0, right: 0 } };

  const seatH = clamp(h * 0.13, 52, 104);
  const colW = clamp(w * 0.2, SEAT_MIN_W, 150);
  // Топбар не должен «съесть» всю посадку: на очень низком экране ограничиваем его вклад.
  const top0 = clamp(opts.topOffset ?? 0, 0, h * 0.3);
  const areaH = Math.max(top0 + seatH, h * SEATS_AREA_H);

  // Сколько влезает в верхнюю полосу по минимальной ширине места.
  const topCap = Math.max(1, Math.floor(w / SEAT_MIN_W));
  const topCount = Math.min(ids.length, topCap);
  const overflow = ids.length - topCount;

  // Лишние делим на две колонки: первый лишний — направо (правша тянет колоду правой),
  // дальше по очереди. Правой достаётся больше при нечётном остатке.
  const rightCount = Math.ceil(overflow / 2);
  const leftCount = overflow - rightCount;

  const insets: SeatInsets = {
    top: topCount > 0 ? top0 + seatH : 0,
    left: leftCount > 0 ? colW : 0,
    right: rightCount > 0 ? colW : 0,
  };

  const seats: SeatBox[] = [];

  // Верхняя полоса: ширина делится поровну между теми, кто в ней сидит, но сама полоса
  // сжимается боковыми колонками — иначе углы «П» перекрывались бы.
  const topLeftEdge = insets.left;
  const topRightEdge = w - insets.right;
  const topW = Math.max(0, topRightEdge - topLeftEdge);
  const cellW = topW / topCount;
  for (let i = 0; i < topCount; i++) {
    seats.push({
      id: ids[i],
      side: "top",
      rect: {
        cx: topLeftEdge + cellW * (i + 0.5),
        cy: top0 + seatH / 2,
        w: Math.max(1, cellW - GAP),
        h: Math.max(1, seatH - GAP),
        r: SEAT_R,
      },
    });
  }

  // Колонки идут сверху вниз, начиная сразу под верхней полосой. Если мест в колонке
  // больше, чем влезает по высоте, они честно ужимаются — все всё равно на экране.
  const colTop = insets.top;
  const colH = Math.max(0, areaH - colTop);
  const columns: Array<{ side: SeatSide; count: number; cx: number }> = [
    { side: "right", count: rightCount, cx: w - colW / 2 },
    { side: "left", count: leftCount, cx: colW / 2 },
  ];
  // Раздаём лишних по колонкам в том же чередовании, в каком считали их количество.
  const rest = ids.slice(topCount);
  const perColumn: Record<string, string[]> = { right: [], left: [] };
  rest.forEach((id, i) => perColumn[i % 2 === 0 ? "right" : "left"].push(id));

  for (const col of columns) {
    if (col.count === 0) continue;
    const cellH = colH / col.count;
    perColumn[col.side].forEach((id, i) => {
      seats.push({
        id,
        side: col.side,
        rect: {
          cx: col.cx,
          cy: colTop + cellH * (i + 0.5),
          w: Math.max(1, colW - GAP),
          h: Math.max(1, cellH - GAP),
          r: SEAT_R,
        },
      });
    });
  }

  return { seats, insets };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
