// Подписи дроп-зон. В покое зона подписана тем, ЧТО она есть («стол», «рука»); во время
// драга — КРАТКИМ призывом к действию («сброс», «на стол», «в руку») — что произойдёт,
// если бросить сюда карту, которая сейчас в руке у игрока.

import type { DropZone } from "./dropZones";

// Тащат всегда ОДНУ карту: «card» — свою (перестановка/раздача из руки), «take» — чужую со
// стола в режиме свободы (жест тот же, а смысл обратный, и подпись должна говорить об этом).
export type DraggedKind = "card" | "take";

const TITLES: Record<DropZone, string> = {
  center: "стол",
  hand: "рука",
  deck: "колода",
  discard: "сброс",
};

export function zoneTitle(zone: DropZone, inGame = false): string {
  if (inGame && zone === "center") return "игра";
  return TITLES[zone];
}

/**
 * Краткий глагол-действие поверх бокса во время драга. Не полное предложение, а призыв:
 * «сброс», «на стол», «в руку». Колода в игре карт не принимает — там будет не глагол, а
 * «низя» (рисуется отдельным запретным оверлеем, см. zoneChrome).
 */
export function zoneAction(zone: DropZone, dragged: DraggedKind, inGame = false): string {
  switch (zone) {
    case "discard":
      return "сброс";
    case "hand":
      // Всегда «в руку» — и когда берёшь чужую карту со стола, и когда кладёшь свою.
      // Разнобоя «в руке»/«раздать» быть не должно.
      void dragged;
      return "в руку";
    case "deck":
      return "низя";
    case "center":
      // В игре центр — игральная зона (карта остаётся на столе); в раздаче — место колоды.
      return inGame ? "на стол" : "в колоду";
  }
}

/**
 * Где рисовать подпись зоны:
 *   center  — полупрозрачно в середине бокса (стол, рука, сброс);
 *   outside — снаружи бокса (колода: внутри её закрывают карты стопки);
 *   none    — не рисовать (у мест игроков свой лейбл).
 * Общая настройка зон: место лейбла — свойство самой зоны, а не частный случай в рисовании.
 */
export type LabelPlacement = "center" | "outside" | "none";

export function zoneLabelPlacement(zone: DropZone): LabelPlacement {
  return zone === "deck" ? "outside" : "center";
}
