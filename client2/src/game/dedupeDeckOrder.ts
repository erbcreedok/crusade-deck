// Защита от раздутой колоды: оставляем первое вхождение каждой карты.
// Нужна, пока клиент/сервер могут прислать дубликаты после кривого реордера.

export function dedupeDeckOrder(cards: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cards) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}
