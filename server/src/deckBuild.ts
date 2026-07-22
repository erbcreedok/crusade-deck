// Сборка свежей колоды. Пока это единственная «фабрика» карт: и при создании комнаты,
// и при сбросе колоды (reset_deck) — чтобы состав колоды описывался ровно в одном месте.

export type DeckType = "36" | "52";

export const SUITS = ["♠", "♥", "♦", "♣"] as const;
export const RANKS_36 = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
export const RANKS_52 = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;

/** Колода по мастям, каждая масть — по возрастанию ранга. Неперемешанная. */
export function buildDeck(deckType: DeckType): string[] {
  const ranks = deckType === "52" ? RANKS_52 : RANKS_36;
  const deck: string[] = [];
  for (const suit of SUITS) {
    for (const rank of ranks) deck.push(rank + suit);
  }
  return deck;
}

/** Любое значение с клиента → допустимый тип колоды (по умолчанию 36). */
export function normalizeDeckType(value: unknown): DeckType {
  return value === "52" ? "52" : "36";
}
