// Куда движок рисует колоду с точки зрения ЛОКАЛЬНОГО игрока. Сервер хранит
// deckLocation ("center" или sessionId держателя сейф-зоны); здесь переводим её
// в мою перспективу. Чужие сейф-зоны пока не рисуем → "away" = просто пропала.
export type DeckZone = "center" | "safe" | "away";

export function deckZoneFor(deckLocation: string, mySessionId: string): DeckZone {
  if (!deckLocation || deckLocation === "center") return "center";
  if (deckLocation === mySessionId) return "safe";
  return "away";
}
