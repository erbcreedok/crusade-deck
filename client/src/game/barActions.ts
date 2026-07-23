import type { Selection } from "./selection";

// Что показывают две кнопки панели действий прямо сейчас. Кнопки не «принадлежат»
// какому-то экрану — они перестраиваются под роль игрока и состояние стола.
//
// Состояний стола ровно два: РАЗДАЧА (дилер тасует и раздаёт, остальные жмут «Готов») и
// СВОБОДА после «ГОУ!» (карты со стола берут сами, дилеру остаётся «Перераздача»).

export type BarActionId =
  | "ready"
  | "unready"
  | "wait"
  | "shuffle"
  // Автораздача живёт в меню (см. roomMenu.ts), но остаётся действием панели по смыслу.
  | "auto_deal"
  | "auto_deal_stop"
  | "go"
  // Перераздача переехала с панели в меню (roomMenu.ts), но осталась действием по смыслу.
  | "redeal"
  | "take_one"
  | "take_all";

export interface BarAction {
  id: BarActionId;
  label: string;
}

export interface BarActions {
  main: BarAction | null;
  secondary: BarAction | null;
}

export interface BarContext {
  /** Игра пошла: карты со стола берут сами (см. GameState.freeMode). */
  freeMode?: boolean;
  /** Сколько карт осталось на столе: пусто — брать нечего. */
  deckCount?: number;
  amIDealer?: boolean;
  myReady?: boolean;
  myFanOpen?: boolean; // задел под будущие кнопки у раскрытой руки
}

const NOTHING: BarActions = { main: null, secondary: null };

// Выделение пока ни на что не влияет: единственная выделяемая стопка — своя рука, и
// действий у неё нет. Параметр остаётся в сигнатуре, потому что кнопки под выделенное —
// исходная идея панели, и к ней вернутся, когда стопок на столе станет больше.
export function barActionsFor(_sel: Selection, ctx: BarContext): BarActions {
  // Свобода проверяется ПЕРВОЙ. Кнопки тут у ВСЕХ одинаковые: ролей за столом больше нет,
  // каждый берёт карты сам — пальцем со стола или этими двумя кнопками.
  if (ctx.freeMode) {
    if ((ctx.deckCount ?? 0) <= 0) return NOTHING; // стол разобран — брать нечего
    return {
      main: { id: "take_one", label: "Забрать 1" },
      secondary: { id: "take_all", label: "Забрать все" },
    };
  }

  if (ctx.amIDealer) {
    return {
      main: { id: "shuffle", label: "Перемешать" },
      // «ГОУ!» — старт игры. Автораздача уехала в меню: она вспомогательная, а место
      // на панели одно, и занимать его должно то, чем заканчивается раздача.
      secondary: { id: "go", label: "ГОУ!" },
    };
  }

  return {
    main: ctx.myReady ? { id: "unready", label: "Не готов" } : { id: "ready", label: "Готов" },
    secondary: { id: "wait", label: "Ждите…" }, // disabled снаружи
  };
}
