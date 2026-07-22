// «Шеренга» — как лежит своя рука ВНЕ фокуса. Задача раскладки ровно одна: игрок должен
// видеть, СКОЛЬКО у него карт, но не видеть, какие именно. Поэтому первая карта стоит
// открыто, а остальные сжаты в плотную пачку: торцы видно и можно сосчитать, номиналы —
// нет. Чистая математика, движок только расставляет по этим числам.

// Насколько первая карта отодвинута от пачки: чуть больше своей ширины, чтобы её ничем
// не перекрывало (карты рисуются слева направо, каждая следующая поверх предыдущей).
const LEAD_GAP = 1.06;
const MAX_STEP = 0.3; // предпочтительный шаг в пачке, в ширинах карты
const MIN_STEP = 2; // px: даже в огромной руке торец карты должен быть виден

// Смещения карт по X от левого края ряда (для карты с якорем по центру прибавь cardW/2).
export function rowOffsets(count: number, cardW: number, maxWidth: number): number[] {
  if (count <= 0) return [];
  const lead = cardW * LEAD_GAP;
  if (count === 1) return [0];
  const packCount = count - 1;
  const space = Math.max(0, maxWidth - cardW - lead);
  const step = Math.max(MIN_STEP, Math.min(cardW * MAX_STEP, packCount > 1 ? space / (packCount - 1) : space));
  const out = [0];
  for (let i = 1; i < count; i++) out.push(lead + (i - 1) * step);
  return out;
}

// Полная ширина шеренги — по ней ряд центрируется в зоне руки.
export function rowWidth(count: number, cardW: number, maxWidth: number): number {
  const offsets = rowOffsets(count, cardW, maxWidth);
  return offsets.length === 0 ? 0 : offsets[offsets.length - 1] + cardW;
}
