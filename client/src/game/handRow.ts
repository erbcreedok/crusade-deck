// «Шеренга» — как лежит своя рука ВНЕ фокуса. Задача раскладки ровно одна: игрок должен
// видеть, СКОЛЬКО у него карт, но не видеть, какие именно.
//
// Достигается это равномерным шагом. Порядок наложения ставит движок и он один на все
// раскладки руки: z растёт слева направо, ПРАВАЯ карта лежит сверху и видна целиком, каждая
// левее уходит под соседку справа и показывает полоску шириной в шаг. То же правило у веера
// (см. fan.ts) — рука не должна перекладываться наоборот при сворачивании.

// Шаг подобран так, чтобы рука читалась как ПАЧКА, а не как разложенный ряд: видно
// торцы и их можно сосчитать, но номиналы не прочитать даже на пустой руке из трёх карт.
const MAX_STEP = 0.13; // предпочтительный шаг, в ширинах карты
const MIN_STEP = 2; // px: даже в огромной руке торец карты должен быть виден

// Шаг между картами: сжимаемся под ширину зоны, но не мельче MIN_STEP.
export function rowStep(count: number, cardW: number, maxWidth: number): number {
  if (count <= 1) return 0;
  const space = Math.max(0, maxWidth - cardW);
  return Math.max(MIN_STEP, Math.min(cardW * MAX_STEP, space / (count - 1)));
}

// Смещения карт по X от левого края ряда (для карты с якорем по центру прибавь cardW/2).
export function rowOffsets(count: number, cardW: number, maxWidth: number): number[] {
  if (count <= 0) return [];
  const step = rowStep(count, cardW, maxWidth);
  return Array.from({ length: count }, (_, i) => i * step);
}

// Полная ширина шеренги — по ней ряд центрируется в зоне руки.
export function rowWidth(count: number, cardW: number, maxWidth: number): number {
  if (count <= 0) return 0;
  return (count - 1) * rowStep(count, cardW, maxWidth) + cardW;
}
