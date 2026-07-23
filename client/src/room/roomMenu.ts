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
  | "toggle_deal_mode"
  | "sort_suit"
  | "sort_rank"
  | "deck_to_center"
  | "toggle_hand"
  | "shuffle"
  | "flip_deck"
  | "leave"
  | "settings";

export interface MenuEntry {
  id: MenuActionId;
  label: string;
}

export interface RoomMenuFlags {
  dealMode: boolean;
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
  /** Колода унесена со стола — дилер может вернуть её в центр. */
  showDeckPlaceholder: boolean;
  /** Инструменты колоды (тасовка/переворот) доступны. */
  showDeckTools: boolean;
}

export function roomMenu(f: RoomMenuFlags): MenuEntry[] {
  const items: MenuEntry[] = [];

  // Дилерская работа с раздачей. В свободе её нет: сбор карт переехал в кнопку
  // «Перераздача», а сброс колоды сервер и так отклонит — фаза уже не лобби.
  if (f.dealMode && f.amIDealer && !f.freeMode) {
    items.push({ id: "collect_hands", label: "Собрать все карты" });
    items.push({ id: "reset_deck", label: "Сбросить колоду" });
    items.push(
      f.autoDealing
        ? { id: "auto_deal_stop", label: "⏹ Стоп раздача" }
        : { id: "auto_deal", label: "Автораздача" },
    );
  }
  // Вход и выход из режима раздачи — дилерский тумблер: выключение раскрывает колоду.
  if (f.amIDealer) {
    items.push({
      id: "toggle_deal_mode",
      label: f.dealMode ? "🎲 Режим раздачи: вкл" : "🎲 Режим раздачи: выкл",
    });
  }
  // Сортировать нечего, пока в руке одна карта или веер сложен.
  if (f.handFanOpen && f.handSize > 1) {
    items.push({ id: "sort_suit", label: "Сортировать по масти" });
    items.push({ id: "sort_rank", label: "Сортировать по номиналу" });
  }
  if (f.showDeckPlaceholder && f.amIDealer) {
    items.push({ id: "deck_to_center", label: "↩ Вернуть колоду в центр" });
  }
  if (f.phase === "lobby") {
    items.push({ id: "toggle_hand", label: f.handOpen ? "🔓 Рука открыта" : "🔒 Рука закрыта" });
  }
  if (f.showDeckTools) {
    items.push({ id: "shuffle", label: "Растасовать" });
    // Переворот колоды — только со сложенным веером: у раскрытого он не читается.
    if (!f.handFanOpen) items.push({ id: "flip_deck", label: "🎴 Перевернуть колоду" });
  }
  items.push({ id: "settings", label: "⚙ Настройки" });
  items.push({ id: "leave", label: "🚪 Выйти в меню" }); // последний = верхний в веере
  return items;
}
