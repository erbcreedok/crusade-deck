// Перестановка карты внутри колоды. Чистая функция — тестируется юнитами и используется
// клиентом для оптимистичного реордера; на сервере лежит её копия (server/src/deckOrder.ts),
// общего пакета между client/server нет.

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
