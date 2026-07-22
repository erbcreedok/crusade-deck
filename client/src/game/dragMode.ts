import type { DeckZone } from "./deckZone";

// Что берёт палец, когда нажимает на карты. Правило зависит от того, в фокусе рука или нет:
//
//   рука вне фокуса — она «сложена»: тащится вся колода целиком (в любую дроп-зону),
//                     отдельные карты не трогаются и не подсвечиваются;
//   рука в фокусе   — она разложена веером: берутся только ОТДЕЛЬНЫЕ карты,
//                     колоду из руки целиком утащить нельзя;
//   другие зоны     — колода тащится целиком всегда, фокус руки на них не влияет.
//
// Отдельный модуль, потому что это правило игры, а не деталь отрисовки: движок просто
// спрашивает у него, что делать с нажатием.

export type DragMode = "deck" | "card" | "none";

export interface DragContext {
  zone: DeckZone;
  handFocused: boolean;
  draggable: boolean; // двигать колоду может только дилер и только в лобби
}

export function dragModeFor({ zone, handFocused, draggable }: DragContext): DragMode {
  if (!draggable || zone === "away") return "none";
  if (zone === "hand") return handFocused ? "card" : "deck";
  return "deck";
}
