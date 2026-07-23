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
  deck: "колода",
  discard: "сброс",
};

const ACTIONS: Record<DraggedKind, Record<DropZone, string>> = {
  card: {
    center: "вернуть в колоду", // в раздаче центр стола — это и есть место колоды
    hand: "оставить в руке",
    deck: "колода закрыта",
    discard: "сбросить",
  },
  take: {
    center: "оставить на столе",
    hand: "взять себе",
    deck: "колода закрыта",
    discard: "сбросить",
  },
};

// Центр стола — единственная зона, которая в игре означает СОВСЕМ другое: в раздаче там
// лежит колода и брошенная карта возвращается в неё, а в игре там игральная зона и карта
// на столе остаётся. Подпись обязана говорить именно то, что случится.
const GAME_ACTIONS: Partial<Record<DraggedKind, Partial<Record<DropZone, string>>>> = {
  card: { center: "выложить на стол" },
  take: { center: "оставить на столе" },
};

export function zoneTitle(zone: DropZone, inGame = false): string {
  if (inGame && zone === "center") return "игра";
  return TITLES[zone];
}

export function zoneAction(zone: DropZone, dragged: DraggedKind, inGame = false): string {
  return (inGame ? GAME_ACTIONS[dragged]?.[zone] : undefined) ?? ACTIONS[dragged][zone];
}
