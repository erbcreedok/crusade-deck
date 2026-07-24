// Верх колоды: в массиве индекс 0 — задняя/нижняя, length-1 — лицевая/верхняя
// (см. deckStack, dealCards.pop, визуальный stackOffset).

export function topCard(deck: readonly string[]): string | null {
  if (deck.length === 0) return null;
  return deck[deck.length - 1]!;
}

// Какую карту берём для раздачи: из стопки — всегда верх; из веера — под пальцем/пивотом.
export function dealSourceIndex(deckLength: number, fanned: boolean, nearestIndex: number): number {
  if (deckLength <= 0) return 0;
  if (!fanned) return deckLength - 1;
  return Math.max(0, Math.min(deckLength - 1, nearestIndex));
}
