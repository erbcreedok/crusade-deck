// Подписи дроп-зон. В покое зона подписана тем, ЧТО она есть («стол», «рука»); во время
// драга — тем, ЧТО ПРОИЗОЙДЁТ, если бросить сюда именно то, что сейчас в руке у игрока.
// Текст зависит от перетаскиваемого: колода и одна карта попадают в зону по-разному.

import type { DropZone } from "./dropZones";

// «take» — карта, которую игрок тянет СЕБЕ со стола в режиме свободы: жест тот же, что у
// раздачи, а смысл обратный, и подпись зоны должна говорить именно об этом.
export type DraggedKind = "deck" | "card" | "take";

const TITLES: Record<DropZone, string> = {
  center: "стол",
  hand: "рука",
};

const ACTIONS: Record<DraggedKind, Record<DropZone, string>> = {
  deck: {
    center: "выложить на стол",
    hand: "взять в руку",
  },
  card: {
    center: "сыграть на стол",
    hand: "оставить в руке",
  },
  take: {
    center: "оставить на столе",
    hand: "взять себе",
  },
};

export function zoneTitle(zone: DropZone): string {
  return TITLES[zone];
}

export function zoneAction(zone: DropZone, dragged: DraggedKind): string {
  return ACTIONS[dragged][zone];
}
