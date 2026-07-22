// Направление КАЖДОЙ карты в колоде (лицом вверх/рубашкой). Направление принадлежит карте,
// а не месту в колоде: после тасовки/перестановки карта уносит свою сторону с собой.
// Поэтому бывает и так, что с обеих сторон колоды рубашки — или, наоборот, лица.
// Чистая логика: сервер хранит результат, вся анимация переворота живёт на клиенте.

export type Facing = Record<string, boolean>; // карта → лежит ли лицом вверх

// Перевернуть колоду целиком (как физическую стопку): порядок реверсится, и каждая карта
// меняет свою сторону. Отсюда и «кнопка открывает карты»: рубашками вниз → лицом вверх.
export function flipWholeDeck(order: readonly string[], facing: Facing): { order: string[]; facing: Facing } {
  const next: Facing = {};
  for (const card of order) next[card] = !facing[card];
  return { order: [...order].reverse(), facing: next };
}

// Перевернуть отдельные карты на месте (жесты по вееру). Порядок не меняется.
export function flippedFacing(facing: Facing, cards: readonly string[]): Facing {
  const next: Facing = { ...facing };
  for (const card of new Set(cards)) {
    if (card in next) next[card] = !next[card];
  }
  return next;
}
