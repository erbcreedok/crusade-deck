import type { RoomLayout, RoundedRect } from "./layout";
import type { SeatBox } from "./seatLayout";

// Куда можно бросить колоду:
//   center — общий стол,
//   hand   — моя рука: единственное место, где карты лежат веером и открыты.
export type DropZone = "center" | "hand";

export interface DropTarget {
  zone: DropZone;
}

export interface ZoneDef {
  rect: RoundedRect;
  droppable: boolean;
}

export function dropZoneRegions(layout: RoomLayout): Record<DropZone, ZoneDef> {
  return {
    center: { rect: layout.centerZone, droppable: true },
    hand: { rect: layout.handZone, droppable: true },
  };
}

function inRect(r: RoundedRect, x: number, y: number): boolean {
  return r.w > 0 && r.h > 0 && Math.abs(x - r.cx) <= r.w / 2 && Math.abs(y - r.cy) <= r.h / 2;
}

function normDist(r: RoundedRect, x: number, y: number): number {
  const dx = (x - r.cx) / (r.w / 2);
  const dy = (y - r.cy) / (r.h / 2);
  return dx * dx + dy * dy;
}

// Место игрока целиком — дроп-зона: бросок колоды туда отдаёт её этому игроку.
// Возвращает id игрока под точкой или null. Места между собой не пересекаются
// (см. seatLayout), поэтому берём первое попадание.
export function pickSeat(x: number, y: number, seats: SeatBox[]): string | null {
  return seats.find((s) => inRect(s.rect, x, y))?.id ?? null;
}

// Кому раздать карту при дропе: чужое место или своя полоса руки (дилер себе).
// Места приоритетнее руки, если вдруг пересекутся.
// readyIds — кто включил дроп-зону кнопкой «Готов». Своя рука всегда принимает
// (дилер себе), даже если он сам не жал «Готов».
// selfOnly — режим свободы: карту тянут ТОЛЬКО себе, чужие места дроп не принимают.
export function pickDealTarget(
  x: number,
  y: number,
  seats: SeatBox[],
  layout: RoomLayout,
  selfId: string | null,
  readyIds?: ReadonlySet<string> | null,
  selfOnly = false,
): string | null {
  const seat = pickSeat(x, y, seats);
  if (seat) {
    if (selfOnly && seat !== selfId) return null;
    if (readyIds && seat !== selfId && !readyIds.has(seat)) return null;
    return seat;
  }
  if (selfId && pickDropTarget(x, y, layout)?.zone === "hand") return selfId;
  return null;
}

// Что под точкой (x,y): зона стола или рука. При перекрытии —
// ближайшая по нормированному расстоянию до центра зоны.
export function pickDropTarget(x: number, y: number, layout: RoomLayout): DropTarget | null {
  const regions = dropZoneRegions(layout);
  const inside = (Object.keys(regions) as DropZone[]).filter((z) => inRect(regions[z].rect, x, y));
  if (inside.length === 0) return null;
  return { zone: inside.sort((a, b) => normDist(regions[a].rect, x, y) - normDist(regions[b].rect, x, y))[0] };
}
