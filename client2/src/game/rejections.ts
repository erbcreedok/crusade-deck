// Тексты отказов сервера. Клиент показывает жест оптимистично, СРАЗУ — поэтому на каждый
// отказ приходит код причины, и игрок видит объяснение поверх стола, а не необъяснимо
// дёрнувшуюся карту. Текст короткий: это надпись на столе, а не абзац.
//
// Раньше причин было шесть — все про перевороты колоды. Перевороты ушли вместе с
// «выключенным режимом раздачи»: карты в колоде всегда лежат рубашкой вверх.

export const REJECT_REASONS = ["free_mode"] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

const TEXTS: Record<RejectReason, string> = {
  free_mode: "карты теперь берут сами",
};

export function isRejectReason(v: unknown): v is RejectReason {
  return typeof v === "string" && (REJECT_REASONS as readonly string[]).includes(v);
}

export function rejectionText(reason: string): string {
  return isRejectReason(reason) ? TEXTS[reason] : "так нельзя";
}
