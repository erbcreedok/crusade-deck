// Выделение элементов стола. Тап (не драг) выделяет элемент: колоду, карту, игрока —
// дальше появятся и другие типы. Правило одно и общее для всех типов:
//
//   выделять можно только элементы ОДНОГО типа. Тап по элементу другого типа
//   сбрасывает весь прежний выбор и начинает новый.
//
// Внутри типа выбор копится: несколько колод — вместе, карты из разных колод — вместе.
// Что делать с выделенным, решает не этот модуль, а barActions.ts (кнопки панели).

export type SelectableType = "deck" | "card" | "player";

export interface Selection {
  type: SelectableType | null; // null — не выделено ничего
  ids: readonly string[];
}

export const EMPTY_SELECTION: Selection = { type: null, ids: [] };

export function clearSelection(): Selection {
  return EMPTY_SELECTION;
}

export function selectionSize(sel: Selection): number {
  return sel.ids.length;
}

export function isSelected(sel: Selection, type: SelectableType, id: string): boolean {
  return sel.type === type && sel.ids.includes(id);
}

// Тап, который только ВЫДЕЛЯЕТ и никогда не снимает выделение. Нужен там, где по элементу
// работают жестами: рука в фокусе ловит тык и глиссандо, и если бы тап переключал выбор,
// она сворачивалась бы прямо посреди работы с картами. Свернуть руку можно явно —
// стрелкой под веером, свайпом вниз или тапом мимо.
export function selectOnly(sel: Selection, type: SelectableType, id: string): Selection {
  if (sel.type === type && sel.ids.includes(id)) return sel;
  if (sel.type !== type) return { type, ids: [id] };
  return { type, ids: [...sel.ids, id] };
}

// Тап по элементу. Тот же тип — добавляем/убираем из набора; другой тип — начинаем
// выбор заново. Возвращает НОВОЕ выделение, прежнее не трогает.
export function toggleSelection(sel: Selection, type: SelectableType, id: string): Selection {
  if (sel.type !== type) return { type, ids: [id] };
  const has = sel.ids.includes(id);
  const ids = has ? sel.ids.filter((x) => x !== id) : [...sel.ids, id];
  // Сняли последний — выделения больше нет, а значит нет и типа: следующий тап
  // по чему угодно начнёт с чистого листа.
  return ids.length === 0 ? EMPTY_SELECTION : { type, ids };
}
