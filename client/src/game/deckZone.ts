// Куда движок рисует колоду с точки зрения ЛОКАЛЬНОГО игрока. Сервер хранит пару
// (deckLocation, deckSlot): чей это стол/игрок и где именно у него лежит колода.
//   center — общий стол,
//   hand   — МОЯ рука: единственное место, где колода раскрывается веером,
//   safe — МОЙ сейф (слот 0..2): закрытая стопка, веера там не бывает,
//   seat   — место другого игрока за столом,
//   away   — держателя за столом нет (вышел): рисовать негде.
export type DeckZone = "center" | "hand" | "safe" | "seat" | "away";

export interface DeckPlace {
  zone: DeckZone;
}

export function deckPlaceFor(
  deckLocation: string,
  deckSlot: string,
  mySessionId: string,
  isSeated: (id: string) => boolean = () => false,
): DeckPlace {
  if (!deckLocation || deckLocation === "center") return { zone: "center" };
  if (deckLocation === mySessionId) {
    // Всё, что не рука, — сейф: колода не должна «пропасть» из-за рассинхрона,
    // пусть лучше лежит на видном месте закрытой.
    return { zone: deckSlot === "hand" ? "hand" : "safe" };
  }
  return isSeated(deckLocation) ? { zone: "seat" } : { zone: "away" };
}
