// Куда движок рисует колоду с точки зрения ЛОКАЛЬНОГО игрока. Сервер хранит
// deckLocation: "center" или id держателя.
//   center — общий стол,
//   hand   — МОЯ рука: единственное место, где колода раскрывается веером,
//   seat   — место другого игрока за столом,
//   away   — держателя за столом нет (вышел): рисовать негде.
export type DeckZone = "center" | "hand" | "seat" | "away";

export interface DeckPlace {
  zone: DeckZone;
}

export function deckPlaceFor(
  deckLocation: string,
  mySessionId: string,
  isSeated: (id: string) => boolean = () => false,
): DeckPlace {
  if (!deckLocation || deckLocation === "center") return { zone: "center" };
  // Личная зона осталась одна — рука: если колода у меня, она там.
  if (deckLocation === mySessionId) return { zone: "hand" };
  return isSeated(deckLocation) ? { zone: "seat" } : { zone: "away" };
}
