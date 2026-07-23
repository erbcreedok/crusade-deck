// Условие сна рендер-цикла. Движок рисует, только когда что-то реально движется; в простое
// — ноль rAF/рендеров. Список активностей ЯВНЫЙ и живёт здесь, а не россыпью в onTick:
// любая новая непрерывная анимация обязана появиться в этом типе, иначе она либо не
// проиграется (цикл уснёт под ней), либо навсегда оставит движок бодрствовать.

export interface EngineActivity {
  /** Настоящая растасовка: карты летят из старых слотов в новые. */
  shuffle: boolean;
  /** «Сумбур» — лид-ин, пока не пришёл новый порядок. */
  scramble: boolean;
  /** Выплеск карт по свайпу вверх. */
  splash: boolean;
  /** Отложенный порядок после кнопочной тасовки. */
  pendingShuffle: boolean;
  /** Переворот карт/колоды. */
  flip: boolean;
  /** Резиновая тянучка запрещённого жеста. */
  stretch: boolean;
  /** Надпись-объяснение поверх стола. */
  notice: boolean;
  /** Клич «ГОУ!» на весь стол. */
  shout: boolean;
  /** Кричалка игрока («гхх гхх гхх» / «сосааааать»). */
  taunt: boolean;
  /** «Ударный» отскок запрещённого дропа. */
  reject: boolean;
  /** Сколько карт-призраков сейчас в полёте (раздача/сбор). */
  flights: number;
  /** Палец на карте / карта в драге. */
  cardPress: boolean;
  cardDrag: boolean;
  /** Кнопка «сложить» ещё проявляется или гаснет. */
  collapseBusy: boolean;
  /** Живёт ли idle-«дыхание» карт (гасится профилем анимаций). */
  idle: boolean;
  /** Волна/дрожание тесного веера. */
  fanWiggle: boolean;
  /** Все карты колоды и руки доехали до своих целей (пружины успокоились). */
  cardsResting: boolean;
  handResting: boolean;
}

/** Можно ли усыпить рендер-цикл прямо сейчас. */
export function canSleep(a: EngineActivity): boolean {
  return (
    !a.shuffle &&
    !a.scramble &&
    !a.splash &&
    !a.pendingShuffle &&
    !a.flip &&
    !a.stretch &&
    !a.notice &&
    !a.shout &&
    !a.taunt &&
    !a.reject &&
    a.flights === 0 &&
    !a.cardPress &&
    !a.cardDrag &&
    !a.collapseBusy &&
    !a.idle &&
    !a.fanWiggle &&
    a.cardsResting &&
    a.handResting
  );
}
