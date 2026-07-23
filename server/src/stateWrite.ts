import { PlayStack, type GameState, type Player } from "./GameState.js";
import type { PlayStacks } from "./playRules.js";

// Запись в схему в одном месте.
//
// Главная причина существования модуля: `ArraySchema.setAt` за пределами длины ДОПИСЫВАЕТ
// элемент, а не пишет «в дырку» (массив из 3 после setAt(5, x) становится длиной 4). Из-за
// этого колода дважды раздувалась до шестидесяти карт. Поэтому колода и рука пишутся
// ТОЛЬКО через clear() + push() — и ровно этой функцией, а не шестью копиями по файлу.

/** Переписать колоду целиком новым порядком. */
export function writeDeck(state: GameState, order: readonly string[]): void {
  state.deck.clear();
  order.forEach((card) => state.deck.push(card));
}

/** Переписать сброс целиком. */
export function writeDiscard(state: GameState, order: readonly string[]): void {
  state.discard.clear();
  order.forEach((card) => state.discard.push(card));
}

/** Игральная зона из схемы в обычные массивы — с ними работают чистые правила. */
export function playStacks(state: GameState): string[][] {
  return state.play.map((s) => s.cards.toArray());
}

/**
 * Переписать игральную зону целиком.
 *
 * Кучки пересоздаются, а не правятся на месте: список короткий (кучек единицы, карт
 * десятки), зато не приходится держать в голове, какие индексы уцелели после того, как
 * опустевшая кучка исчезла из середины. Точечные патчи здесь экономили бы байты ценой
 * ровно того класса багов, из-за которого в этом файле вообще запрещён `setAt`.
 */
export function writePlay(state: GameState, stacks: PlayStacks): void {
  state.play.clear();
  for (const cards of stacks) {
    const stack = new PlayStack();
    cards.forEach((card) => stack.cards.push(card));
    state.play.push(stack);
  }
}

/** Переписать руку игрока целиком новым порядком. */
export function writeHand(player: Player, order: readonly string[]): void {
  player.hand.clear();
  order.forEach((card) => player.hand.push(card));
}

/** Стороны карт из схемы в обычный объект (чистые правила работают с ним). */
export function facingRecord(state: GameState): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  state.faceUp.forEach((up, card) => (out[card] = up));
  return out;
}

/** Применить посчитанные стороны карт. Карты, которых нет в наборе, не трогаются. */
export function writeFacing(state: GameState, facing: Record<string, boolean>): void {
  for (const [card, up] of Object.entries(facing)) state.faceUp.set(card, up);
}

/** Свежая колода: и порядок, и стороны заменяются целиком (рубашкой вверх). */
export function writeFreshDeck(state: GameState, order: readonly string[]): void {
  state.faceUp.clear();
  writeDeck(state, order);
  order.forEach((card) => state.faceUp.set(card, false));
}

/** Снимок рук до того, как они опустеют: нужен и для сбора карт, и для анимации облёта. */
export function handsSnapshot(state: GameState): {
  hands: Record<string, string[]>;
  counts: Record<string, number>;
} {
  const hands: Record<string, string[]> = {};
  const counts: Record<string, number> = {};
  state.players.forEach((p, sid) => {
    const cards = p.hand.toArray();
    hands[sid] = cards;
    counts[sid] = cards.length;
  });
  return { hands, counts };
}

/** Опустошить все руки: карты, спрятанные карты и режимы показа (открыта/веером). */
export function clearAllHands(state: GameState): void {
  state.players.forEach((p) => {
    p.hand.clear();
    p.handHidden.clear();
    p.handOpen = false;
    p.handFanned = false;
  });
}
