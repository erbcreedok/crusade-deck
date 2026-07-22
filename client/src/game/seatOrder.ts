// Канонический круг мест (серверный seatOrder) → кого рисовать на ЭТОМ экране.
// Своё место внизу (рука); остальные — по часовой, начиная с соседа слева
// (= следующий в списке после меня).

/** Чужие id: следующий после self, далее по кругу. */
export function seatsForViewer(tableOrder: readonly string[], selfId: string): string[] {
  if (tableOrder.length === 0) return [];
  const i = tableOrder.indexOf(selfId);
  if (i < 0) return tableOrder.filter((id) => id !== selfId);
  const out: string[] = [];
  for (let k = 1; k < tableOrder.length; k++) {
    out.push(tableOrder[(i + k) % tableOrder.length]!);
  }
  return out;
}

/** Сосед слева от игрока (= следующий в круге). */
export function seatOnLeft(tableOrder: readonly string[], playerId: string): string | null {
  if (tableOrder.length < 2) return null;
  const i = tableOrder.indexOf(playerId);
  if (i < 0) return null;
  return tableOrder[(i + 1) % tableOrder.length]!;
}
