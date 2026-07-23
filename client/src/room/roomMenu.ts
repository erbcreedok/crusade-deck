// Пункты слайд-ап меню комнаты. Чистый список «что показать» — обработчики навешивает
// RoomScreen. Раньше это была лента из десятка if-ов посреди компонента, и понять, что
// именно видит игрок в данный момент, можно было только вычитав её целиком.
//
// Порядок в массиве — снизу вверх на экране: веер рендерит список развёрнутым (см.
// ActionBar), поэтому ПОСЛЕДНИЙ пункт оказывается ВЕРХНИМ, ближайшим к большому пальцу
// у края экрана. Отсюда «Выйти в меню» в самом конце списка.

export type MenuActionId =
  | "collect_hands"
  | "reset_deck"
  | "auto_deal"
  | "auto_deal_stop"
  | "sort_suit"
  | "sort_rank"
  | "toggle_hand"
  | "leave"
  | "settings";

export interface MenuEntry {
  id: MenuActionId;
  label: string;
}

export interface RoomMenuFlags {
  /** Режим свободы: колода на столе общая, дилерских действий с ней больше нет. */
  freeMode: boolean;
  amIDealer: boolean;
  /** Автораздача идёт прямо сейчас — пункт превращается в «стоп». */
  autoDealing: boolean;
  phase: "lobby" | "playing" | "finished";
  /** Веер своей руки раскрыт — только тогда сортировка имеет смысл. */
  handFanOpen: boolean;
  handSize: number;
  /** Своя рука открыта всем (по состоянию сервера). */
  handOpen: boolean;
}

export function roomMenu(f: RoomMenuFlags): MenuEntry[] {
  const items: MenuEntry[] = [];

  // Дилерская работа с раздачей. В свободе её нет: сбор карт переехал в кнопку
  // «Перераздача», а сброс колоды сервер и так отклонит — фаза уже не лобби.
  if (f.amIDealer && !f.freeMode) {
    items.push({ id: "collect_hands", label: "Собрать все карты" });
    items.push({ id: "reset_deck", label: "Сбросить колоду" });
    items.push(
      f.autoDealing
        ? { id: "auto_deal_stop", label: "⏹ Стоп раздача" }
        : { id: "auto_deal", label: "Автораздача" },
    );
  }
  // Сортировать нечего, пока в руке одна карта или веер сложен.
  if (f.handFanOpen && f.handSize > 1) {
    items.push({ id: "sort_suit", label: "Сортировать по масти" });
    items.push({ id: "sort_rank", label: "Сортировать по номиналу" });
  }
  if (f.phase === "lobby") {
    items.push({ id: "toggle_hand", label: f.handOpen ? "🔓 Рука открыта" : "🔒 Рука закрыта" });
  }
  items.push({ id: "settings", label: "⚙ Настройки" });
  items.push({ id: "leave", label: "🚪 Выйти в меню" }); // последний = верхний в веере
  return items;
}
