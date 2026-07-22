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
