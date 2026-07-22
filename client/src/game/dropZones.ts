import type { RoomLayout } from "./layout";

// Дроп-зоны на столе, куда дилер может бросить колоду при драге. Пока две:
// общий центр и своя сейф-зона снизу. Геометрия — эллипсы (для hit-теста и подсветки).
export type DropZone = "center" | "safe";

export interface ZoneEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export function dropZoneRegions(layout: RoomLayout): Record<DropZone, ZoneEllipse> {
  const { center, safeAnchor, cardW, cardH } = layout;
  return {
    center: { cx: center.cx, cy: center.cy, rx: center.rx, ry: center.ry },
    safe: { cx: safeAnchor.x, cy: safeAnchor.y, rx: cardW * 1.3, ry: cardH * 0.95 },
  };
}

function normDist(e: ZoneEllipse, x: number, y: number): number {
  const dx = (x - e.cx) / e.rx;
  const dy = (y - e.cy) / e.ry;
  return dx * dx + dy * dy; // <= 1 внутри эллипса
}

// Какая дроп-зона под точкой (x,y), или null если ни одной. При перекрытии —
// та, к центру которой ближе (нормированно на радиусы).
export function pickDropZone(x: number, y: number, layout: RoomLayout): DropZone | null {
  const regions = dropZoneRegions(layout);
  const inside = (Object.keys(regions) as DropZone[]).filter(
    (z) => regions[z].rx > 0 && regions[z].ry > 0 && normDist(regions[z], x, y) <= 1,
  );
  if (inside.length === 0) return null;
  return inside.sort((a, b) => normDist(regions[a], x, y) - normDist(regions[b], x, y))[0];
}
