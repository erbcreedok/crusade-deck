import { parseCard, SUITS, type Suit } from "./card";

// Сортировка руки на клиенте: на сервер уходит готовый порядок (set_hand_order).
// Состав не меняется — только перестановка.

const SUIT_ORDER = new Map<Suit, number>(SUITS.map((s, i) => [s, i]));

// Номиналы: туз высокий, джокеры/мусор — в конец, стабильно.
const RANK_ORDER: Record<string, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

function rankKey(card: string): number {
  return RANK_ORDER[parseCard(card).rank] ?? 100;
}

function suitKey(card: string): number {
  return SUIT_ORDER.get(parseCard(card).suit) ?? 100;
}

export function sortBySuit(cards: readonly string[]): string[] {
  return cards
    .map((card, i) => ({ card, i }))
    .sort((a, b) => suitKey(a.card) - suitKey(b.card) || rankKey(a.card) - rankKey(b.card) || a.i - b.i)
    .map((x) => x.card);
}

export function sortByRank(cards: readonly string[]): string[] {
  return cards
    .map((card, i) => ({ card, i }))
    .sort((a, b) => rankKey(a.card) - rankKey(b.card) || suitKey(a.card) - suitKey(b.card) || a.i - b.i)
    .map((x) => x.card);
}
