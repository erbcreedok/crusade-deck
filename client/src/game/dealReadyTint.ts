// Цвет зоны руки в режиме раздачи: «Готов» / «Не готов».
// Дилер всегда готов — его дроп-зона не выключается.

/** Жёлтый — дроп-зона открыта (готов). */
export const DEAL_HAND_READY = 0xd9b154;
/** Серый — дроп-зона закрыта (не готов). */
export const DEAL_HAND_NOT_READY = 0x8a9490;

/** Подпись на ховере поверх бокса. */
export const DEAL_HOVER_ACCEPT = "раздать";
export const DEAL_HOVER_REJECT = "Неа";

/** Отбой при дропе в неготового. */
export const DEAL_DROP_REJECT_TEXT = "нииизя";

/** Дилер всегда готов принимать карты. */
export function isDealReady(isReady: boolean, isDealer: boolean): boolean {
  return isDealer || isReady;
}

export function dealHandAccent(ready: boolean): number {
  return ready ? DEAL_HAND_READY : DEAL_HAND_NOT_READY;
}

export function dealSeatHoverLabel(ready: boolean): string {
  return ready ? DEAL_HOVER_ACCEPT : DEAL_HOVER_REJECT;
}
