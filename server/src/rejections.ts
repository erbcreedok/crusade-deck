// Почему серверу пришлось отказать в действии. Клиент показывает переворот оптимистично,
// СРАЗУ — поэтому молчаливый отказ недопустим: без ответа карта так и осталась бы
// повёрнутой не той стороной. На каждый отказ уходит код причины, а текст пишет клиент.

export type RejectReason =
  | "not_dealer"
  | "not_lobby"
  | "deal_mode"
  | "empty_deck"
  | "unknown_cards"
  // Режим свободы: карты со стола игроки берут сами, раздавать в чужие руки нельзя
  // никому, включая дилера. Клиентский двойник списка — client/src/game/rejections.ts.
  | "free_mode";

// cards — что просят перевернуть (пустой список = вся колода), deck — что реально лежит.
// dealMode: пока идёт раздача, номиналов колоды не видит НИКТО, включая дилера, — значит
// и переворачивать нечего. Кнопки в UI на этот случай нет, но проверка обязана быть здесь:
// UI прячет действие, а запрещает его сервер.
export function flipRejectReason(
  player: { isDealer: boolean } | undefined,
  phase: string,
  deck: readonly string[],
  cards: readonly string[],
  dealMode = false,
): RejectReason | null {
  if (!player?.isDealer) return "not_dealer";
  if (phase !== "lobby") return "not_lobby";
  if (dealMode) return "deal_mode";
  if (deck.length === 0) return "empty_deck";
  if (cards.length > 0 && !cards.every((c) => deck.includes(c))) return "unknown_cards";
  return null;
}
