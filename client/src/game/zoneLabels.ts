// Подписи дроп-зон. В покое зона подписана тем, ЧТО она есть («стол», «рука»); во время
// драга — тем, ЧТО ПРОИЗОЙДЁТ, если бросить сюда именно то, что сейчас в руке у игрока.
// Текст зависит от перетаскиваемого: колода и одна карта попадают в зону по-разному.

import type { DropZone } from "./dropZones";

// Тащат всегда ОДНУ карту: «card» — свою (перестановка/раздача), «take» — чужую со стола
// в режиме свободы (жест тот же, а смысл обратный, и подпись должна говорить об этом).
// Колоды целиком в списке нет: она лежит в центре стола и никуда не переносится.
export type DraggedKind = "card" | "take";

const TITLES: Record<DropZone, string> = {
  center: "стол",
  hand: "рука",
  discard: "сброс",
};

const ACTIONS: Record<DraggedKind, Record<DropZone, string>> = {
  card: {
    center: "сыграть на стол",
    hand: "оставить в руке",
    discard: "сбросить",
  },
  take: {
    center: "оставить на столе",
    hand: "взять себе",
    discard: "сбросить",
  },
};

export function zoneTitle(zone: DropZone): string {
  return TITLES[zone];
}

export function zoneAction(zone: DropZone, dragged: DraggedKind): string {
  return ACTIONS[dragged][zone];
}
