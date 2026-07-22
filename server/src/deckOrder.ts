// Перестановка карты внутри колоды. Чистая функция — копия клиентской
// (client/src/game/deckOrder.ts): общего пакета между client/server нет, а логика
// должна совпадать, иначе оптимистичный реордер на клиенте разойдётся с сервером.

// Переставить карту `card` на позицию `to` (индекс в НОВОМ массиве). Индекс прижимается
// к границам; неизвестная карта — копия без изменений. Исходный массив не мутируется.
export function moveCard(order: readonly string[], card: string, to: number): string[] {
  const from = order.indexOf(card);
  if (from < 0) return [...order];
  const next = [...order];
  next.splice(from, 1);
  const at = Math.max(0, Math.min(next.length, Math.trunc(to)));
  next.splice(at, 0, card);
  return next;
}

// «Врезать пачку обратно»: карты `cards` вынимаются из колоды и каждая вставляется на
// случайное место. Все остальные карты сохраняют порядок ОТНОСИТЕЛЬНО ДРУГ ДРУГА — это и
// отличает жест-выплеск (свайп по вееру) от полной перетасовки: игрок кинул несколько
// карт, а не перемешал колоду целиком. rand — источник случайности (инъекция ради тестов).
export function scatterCards(order: readonly string[], cards: readonly string[], rand: () => number): string[] {
  const moving = cards.filter((c) => order.includes(c));
  if (moving.length === 0) return [...order];
  const set = new Set(moving);
  const next = order.filter((c) => !set.has(c)); // порядок оставшихся не трогаем
  for (const card of moving) {
    const at = Math.min(next.length, Math.floor(rand() * (next.length + 1)));
    next.splice(at, 0, card);
  }
  return next;
}
