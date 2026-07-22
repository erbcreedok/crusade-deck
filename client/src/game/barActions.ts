import type { DeckZone } from "./deckZone";
import type { Selection } from "./selection";

// Что показывают две кнопки панели действий прямо сейчас. Кнопки не «принадлежат»
// какому-то экрану — они перестраиваются под ТО, ЧТО ВЫДЕЛЕНО. Здесь только решение
// «что предложить», без отправки на сервер: id действия исполняет вызывающий.

export type BarActionId = "deck_to_hand" | "deck_to_center";

export interface BarAction {
  id: BarActionId;
  label: string;
}

export interface BarActions {
  main: BarAction | null;
  secondary: BarAction | null;
}

export interface BarContext {
  deckZone: DeckZone; // где лежит выделенная колода
  canMoveDeck: boolean; // дилер в лобби — только он двигает колоду
}

const NOTHING: BarActions = { main: null, secondary: null };

export function barActionsFor(sel: Selection, ctx: BarContext): BarActions {
  // Пока описаны действия ровно для ОДНОЙ выделенной колоды. Несколько колод, карты и
  // игроки появятся здесь же — правило кнопок одно, меняется только набор.
  if (sel.type !== "deck" || sel.ids.length !== 1) return NOTHING;
  if (!ctx.canMoveDeck) return NOTHING;

  if (ctx.deckZone === "center") return { main: { id: "deck_to_hand", label: "В руку" }, secondary: null };
  if (ctx.deckZone === "hand") return { main: null, secondary: { id: "deck_to_center", label: "В центр" } };
  // Чужое место и «нигде» — действия ещё не описаны, кнопки остаются пустыми.
  return NOTHING;
}
