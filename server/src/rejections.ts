// Почему серверу пришлось отказать в действии. Клиент показывает переворот оптимистично,
// СРАЗУ — поэтому молчаливый отказ недопустим: без ответа карта так и осталась бы
// повёрнутой не той стороной. На каждый отказ уходит код причины, а текст пишет клиент.

export type RejectReason = "not_dealer" | "not_lobby" | "empty_deck" | "unknown_cards";

// cards — что просят перевернуть (пустой список = вся колода), deck — что реально лежит.
export function flipRejectReason(
  player: { isDealer: boolean } | undefined,
  phase: string,
  deck: readonly string[],
  cards: readonly string[],
): RejectReason | null {
  if (!player?.isDealer) return "not_dealer";
  if (phase !== "lobby") return "not_lobby";
  if (deck.length === 0) return "empty_deck";
  if (cards.length > 0 && !cards.every((c) => deck.includes(c))) return "unknown_cards";
  return null;
}
