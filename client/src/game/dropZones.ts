import type { RoomLayout, RoundedRect } from "./layout";
import type { SeatBox } from "./seatLayout";

// Дроп-зоны на столе. center/safe — куда колоду бросать МОЖНО, hand (зона руки у
// нижнего края) пока НЕДОСТУПНА (дроп → «ударная» анимация возврата). Геометрия —
// скруглённые прямоугольники (для hit-теста и подсветки).
export type DropZone = "center" | "safe" | "hand";

export interface ZoneDef {
  rect: RoundedRect;
  droppable: boolean;
}

export function dropZoneRegions(layout: RoomLayout): Record<DropZone, ZoneDef> {
  return {
    center: { rect: layout.centerZone, droppable: true },
    safe: { rect: layout.safeZone, droppable: true },
    hand: { rect: layout.handZone, droppable: false },
  };
}

// Место игрока целиком — дроп-зона: бросок колоды туда отдаёт её этому игроку.
// Возвращает id игрока под точкой или null. Места между собой не пересекаются
// (см. seatLayout), поэтому берём первое попадание.
export function pickSeat(x: number, y: number, seats: SeatBox[]): string | null {
  return seats.find((s) => inRect(s.rect, x, y))?.id ?? null;
}

function inRect(r: RoundedRect, x: number, y: number): boolean {
  return r.w > 0 && r.h > 0 && Math.abs(x - r.cx) <= r.w / 2 && Math.abs(y - r.cy) <= r.h / 2;
}

function normDist(r: RoundedRect, x: number, y: number): number {
  const dx = (x - r.cx) / (r.w / 2);
  const dy = (y - r.cy) / (r.h / 2);
  return dx * dx + dy * dy;
}

// Какая зона под точкой (x,y), включая запретную, или null. При перекрытии — ближайшая
// по нормированному расстоянию до центра зоны. Проверку «можно ли дропать» делает вызывающий.
export function pickDropZone(x: number, y: number, layout: RoomLayout): DropZone | null {
  const regions = dropZoneRegions(layout);
  const inside = (Object.keys(regions) as DropZone[]).filter((z) => inRect(regions[z].rect, x, y));
  if (inside.length === 0) return null;
  return inside.sort((a, b) => normDist(regions[a].rect, x, y) - normDist(regions[b].rect, x, y))[0];
}
