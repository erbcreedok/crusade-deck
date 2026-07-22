// Разбор карты ("10♠", "A♥") и цвет масти. Чистая логика — тестируется юнитами.
// Масть — последний символ строки, ранг — всё до него.

export const SUITS = ["♠", "♥", "♦", "♣"] as const;
export type Suit = (typeof SUITS)[number];

export interface Card {
  rank: string; // "6".."10","J","Q","K","A"
  suit: Suit;
}

export function parseCard(s: string): Card {
  return { rank: s.slice(0, -1), suit: s.slice(-1) as Suit };
}

export function isCourt(rank: string): boolean {
  return rank === "J" || rank === "Q" || rank === "K";
}

// Цвет масти. Классика: ♥♦ красные, ♠♣ чёрные. Четырёхцветная (для слабовидящих):
// ♠ чёрный, ♥ красный, ♦ оранжевый, ♣ голубой — все четыре различимы.
export function suitColor(suit: Suit, fourColor: boolean): number {
  const RED = 0xd83a3a;
  const BLACK = 0x1a1a1a;
  if (!fourColor) return suit === "♥" || suit === "♦" ? RED : BLACK;
  switch (suit) {
    case "♠":
      return BLACK;
    case "♥":
      return RED;
    case "♦":
      return 0xe08a2a; // оранжевый
    case "♣":
      return 0x2a7ad8; // голубой
  }
}
