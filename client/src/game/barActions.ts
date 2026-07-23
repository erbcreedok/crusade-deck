import type { Selection } from "./selection";
import { TAUNT_LABEL } from "./taunt";

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
  // Кричалки: карты они не трогают, это голос за столом (см. game/taunt.ts).
  | "taunt_gkh"
  | "taunt_suck";

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
  // Свобода проверяется ПЕРВОЙ. Кнопки тут у ВСЕХ одинаковые: ролей за столом больше нет.
  //
  // Карты со стола берут ПАЛЬЦЕМ — тапом по колоде, и это единственный способ: кнопок
  // взятия здесь больше нет. Панель отдана кричалкам, потому что голос — единственное,
  // чего нельзя сделать жестом по столу. По той же причине кнопки не зависят от того,
  // осталось ли что-то в колоде: кричать можно и над пустым столом.
  if (ctx.freeMode) {
    return {
      main: { id: "taunt_gkh", label: TAUNT_LABEL.gkh },
      secondary: { id: "taunt_suck", label: TAUNT_LABEL.suck },
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
