// Правила работы дилера с руками игроков. Чистая логика — состояние меняет CardRoom.

// Вес голоса дилера. Раньше было 1.5 — это давало ему фактическое право вето при двоих
// игроках. Теперь перевес символический: дилер решает лишь равные голосования, а двое
// обычных игроков всегда перевешивают его.
export const DEALER_VOTE_WEIGHT = 1.01;

export interface CollectResult {
  deck: string[];
  faceUp: Record<string, boolean>; // все собранные карты — рубашкой вверх
}

// «Ресет»: дилер забирает карты из ВСЕХ рук обратно в колоду. Карты ложатся под те, что
// уже в колоде, порядок внутри каждой руки сохраняется, всё становится скрытым.
export function collectHands(deck: readonly string[], hands: Record<string, readonly string[]>): CollectResult {
  const next = [...deck];
  for (const hand of Object.values(hands)) next.push(...hand);
  const faceUp: Record<string, boolean> = {};
  for (const card of next) faceUp[card] = false;
  return { deck: next, faceUp };
}

export interface DealResult {
  deck: string[];
  card: string;
}

// Раздать одну карту из колоды. Возвращает колоду без неё; кому карта ушла, решает
// вызывающий (CardRoom кладёт её в hand игрока). Карты нет — раздачи нет (null).
export function dealCardTo(deck: readonly string[], card: string): DealResult | null {
  const i = deck.indexOf(card);
  if (i < 0) return null;
  const next = [...deck];
  next.splice(i, 1);
  return { deck: next, card };
}

// Порядок облёта карт при сборе: по часовой ОТ ДИЛЕРА (его карты летят первыми).
// Правило игры, а не деталь рассылки, — поэтому живёт здесь и проверяется тестами.
// Дилера нет в круге (вышел) — облетаем места как есть, порядок хотя бы стабилен.
export function collectOrder(seatIds: readonly string[], dealerId: string): string[] {
  const di = seatIds.indexOf(dealerId);
  if (di < 0) return [...seatIds];
  return seatIds.map((_, k) => seatIds[(di + k) % seatIds.length]!);
}
