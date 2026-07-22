// Круг мест (seatOrder) как чистые операции над массивом. В схеме он живёт как
// ArraySchema, но вся логика «кого куда поставить» — здесь, и она проверяема тестами.
//
// Порядок по часовой: следующий после игрока = слева от него за столом. Дилер — голова
// круга: клиенты рисуют облёты карт (сбор/сброс) именно от него.

/** Добавить игрока: дилера в голову круга, остальных — в хвост. Повторно — не добавляем. */
export function addSeat(order: readonly string[], sessionId: string, asDealer: boolean): string[] {
  if (order.includes(sessionId)) return [...order];
  return asDealer ? [sessionId, ...order] : [...order, sessionId];
}

/** Возврат игрока под новым sessionId: он садится на СВОЁ прежнее место, а не в хвост. */
export function replaceSeat(order: readonly string[], oldSid: string, newSid: string): string[] {
  const next = [...order];
  const i = next.indexOf(oldSid);
  if (i >= 0) next[i] = newSid;
  else if (!next.includes(newSid)) next.push(newSid);
  return next;
}

export function removeSeat(order: readonly string[], sessionId: string): string[] {
  return order.filter((id) => id !== sessionId);
}

/**
 * Круг только из тех, кто реально в комнате. Кто есть в players, но выпал из круга
 * (рассинхрон), дописывается в хвост — иначе он бы вовсе исчез из облёта карт.
 */
export function seatIdsInOrder(order: readonly string[], playerIds: readonly string[]): string[] {
  const ordered = order.filter((id) => playerIds.includes(id));
  for (const id of playerIds) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}
