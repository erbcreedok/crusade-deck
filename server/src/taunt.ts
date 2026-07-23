// Кричалки: игрок жмёт кнопку — надпись видит весь стол. Родня deck_fx по природе: это
// ЧИСТОЕ украшение, состояния в кричалке нет вообще, поэтому сервер её не интерпретирует,
// а только проверяет вид и раздаёт остальным вместе с автором.
//
// Автора подставляет СЕРВЕР, а не клиент: иначе кричать можно было бы от чужого имени —
// а имя тут и есть весь смысл (надпись вылетает из места того, кто нажал).

export const TAUNT_KINDS = ["gkh", "suck"] as const;
export type TauntKind = (typeof TAUNT_KINDS)[number];

export function sanitizeTaunt(raw: unknown): TauntKind | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = (raw as Record<string, unknown>).kind;
  return TAUNT_KINDS.includes(kind as TauntKind) ? (kind as TauntKind) : null;
}
