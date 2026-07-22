// «Толстый палец»: какие карты считаются задетыми касанием. Палец накрывает пятно, а не
// точку, поэтому тык по колоде выравнивает не одну карту, а всё, что под ним. Чистая
// математика — движок только применяет результат.

export interface Point {
  x: number;
  y: number;
}

export function cardsUnderTouch(positions: readonly Point[], x: number, y: number, radius: number): number[] {
  const r2 = radius * radius;
  const out: number[] = [];
  for (let i = 0; i < positions.length; i++) {
    const dx = positions[i].x - x;
    const dy = positions[i].y - y;
    if (dx * dx + dy * dy <= r2) out.push(i);
  }
  return out;
}
