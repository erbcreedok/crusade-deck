// Тексты отказов сервера. Клиент показывает переворот сразу, оптимистично; если сервер
// не подтвердил — карты возвращаются, и игрок должен понять ПОЧЕМУ, а не увидеть, как
// колода необъяснимо дёрнулась обратно. Текст короткий: он рисуется поверх стола.

export const REJECT_REASONS = [
  "not_dealer",
  "not_lobby",
  "deal_mode",
  "empty_deck",
  "unknown_cards",
  "free_mode",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

const TEXTS: Record<RejectReason, string> = {
  not_dealer: "колоду крутит дилер",
  not_lobby: "игра уже идёт",
  deal_mode: "идёт раздача",
  empty_deck: "колода пуста",
  unknown_cards: "этих карт нет в колоде",
  free_mode: "карты теперь берут сами",
};

// Что делать с отказом на экране. «flip» — откатить оптимистичный переворот (карты уже
// показаны другой стороной); «notice» — только надпись: жест ничего не переворачивал, и
// откатывать нечего. Разделение обязательно: отказ БЕЗ списка карт означает «вся колода»,
// и без этой ветки отказ на раздачу перевернул бы обратно всю колоду ни за что.
const NOTICE_ONLY: readonly RejectReason[] = ["free_mode"];

export function rejectionKind(reason: string): "flip" | "notice" {
  if (!isRejectReason(reason)) return "notice"; // причина неизвестна — чужих карт не трогаем
  return NOTICE_ONLY.includes(reason) ? "notice" : "flip";
}

export function isRejectReason(v: unknown): v is RejectReason {
  return typeof v === "string" && (REJECT_REASONS as readonly string[]).includes(v);
}

export function rejectionText(reason: string): string {
  return isRejectReason(reason) ? TEXTS[reason] : "так нельзя";
}
