// Куда движок рисует колоду с точки зрения ЛОКАЛЬНОГО игрока. Сервер хранит
// deckLocation ("center" или id держателя); здесь переводим её в мою перспективу.
// "seat" — колода лежит на месте другого игрока за столом (места теперь нарисованы,
// см. seatLayout.ts). "away" остаётся страховкой: держателя за столом нет (вышел из
// комнаты, пока колода была у него) — рисовать её негде.
export type DeckZone = "center" | "safe" | "seat" | "away";

export function deckZoneFor(
  deckLocation: string,
  mySessionId: string,
  isSeated: (id: string) => boolean = () => false,
): DeckZone {
  if (!deckLocation || deckLocation === "center") return "center";
  if (deckLocation === mySessionId) return "safe";
  return isSeated(deckLocation) ? "seat" : "away";
}
