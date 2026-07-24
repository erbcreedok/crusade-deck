import type { BoardPile } from "./types";

// Имена стопок доски. Колода и сброс — по одной и навсегда, а кучек игральной зоны
// сколько угодно и они заводятся на ходу, поэтому имя у них составное: `play:<индекс>`.
//
// Строка, а не объект: `boardFan` сравнивается по значению в десятке мест движка
// (`this.boardFan === pile`), и объект пришлось бы сравнивать вручную везде — ровно тот
// случай, когда «более честный тип» стоит дороже, чем даёт.

export function playPile(index: number): BoardPile {
  return `play:${index}`;
}

/** Индекс кучки зоны или null, если это не она (колода, сброс, ничего). */
export function playPileIndex(pile: BoardPile | null | undefined): number | null {
  if (typeof pile !== "string" || !pile.startsWith("play:")) return null;
  const tail = pile.slice("play:".length);
  // Только цифры и хотя бы одна: Number("") это 0, и без этой проверки голое «play:»
  // бодро превращалось бы в кучку номер ноль.
  if (!/^\d+$/.test(tail)) return null;
  return Number(tail);
}

export function isPlayPile(pile: BoardPile | null | undefined): boolean {
  return playPileIndex(pile) !== null;
}
