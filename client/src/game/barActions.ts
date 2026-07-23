import type { DeckZone } from "./deckZone";
import type { Selection } from "./selection";

// Что показывают две кнопки панели действий прямо сейчас. Кнопки не «принадлежат»
// какому-то экрану — они перестраиваются под ТО, ЧТО ВЫДЕЛЕНО / роль × режим.

export type BarActionId =
  | "deck_to_hand"
  | "deck_to_center"
  | "ready"
  | "unready"
  | "wait"
  | "shuffle"
  // Автораздача осталась действием, но переехала с панели в меню (см. roomMenu.ts).
  | "auto_deal"
  | "auto_deal_stop"
  | "go"
  | "redeal";

export interface BarAction {
  id: BarActionId;
  label: string;
}

export interface BarActions {
  main: BarAction | null;
  secondary: BarAction | null;
}

export interface BarContext {
  deckZone: DeckZone;
  canMoveDeck: boolean;
  dealMode?: boolean;
  /** Игра пошла: карты со стола берут сами (см. GameState.freeMode). */
  freeMode?: boolean;
  amIDealer?: boolean;
  autoDealing?: boolean;
  myReady?: boolean;
  myFanOpen?: boolean; // задел под будущие кнопки у раскрытой руки
}

const NOTHING: BarActions = { main: null, secondary: null };

export function barActionsFor(sel: Selection, ctx: BarContext): BarActions {
  // Свобода проверяется ПЕРВОЙ: раздача из неё не выключается (dealMode остаётся), но
  // раздавать больше нечего — единственное дилерское действие теперь «Перераздача».
  if (ctx.freeMode) {
    if (!ctx.amIDealer) return NOTHING; // остальным кнопки не нужны: карту берут жестом
    return { main: { id: "redeal", label: "Перераздача" }, secondary: null };
  }

  // Режим раздачи: кнопки по роли, не по выделению колоды.
  if (ctx.dealMode) {
    if (ctx.amIDealer) {
      return {
        main: { id: "shuffle", label: "Перемешать" },
        // «ГОУ!» — старт игры. Автораздача уехала в меню: она вспомогательная, а место
        // на панели одно, и занимать его должно то, чем заканчивается раздача.
        secondary: { id: "go", label: "ГОУ!" },
      };
    }
    return {
      main: ctx.myReady
        ? { id: "unready", label: "Не готов" }
        : { id: "ready", label: "Готов" },
      secondary: { id: "wait", label: "Ждите…" }, // disabled снаружи
    };
  }

  // Вне раздачи — прежние действия колоды.
  if (sel.type !== "deck" || sel.ids.length !== 1) return NOTHING;
  if (!ctx.canMoveDeck) return NOTHING;

  if (ctx.deckZone === "center") return { main: { id: "deck_to_hand", label: "В руку" }, secondary: null };
  if (ctx.deckZone === "hand") return { main: null, secondary: { id: "deck_to_center", label: "В центр" } };
  return NOTHING;
}
