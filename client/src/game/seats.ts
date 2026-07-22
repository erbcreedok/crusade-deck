// Места за столом. Пока — только сводка (сколько сидит, сколько готово, сколько ботов):
// её показывает топбар комнаты, чтобы было видно, что боты реально за столом.
// Сюда же дальше ляжет посадка по эллипсу, зоны игроков и дроп-зоны.

export interface Seat {
  id: string; // sessionId живого игрока или id бота
  name: string;
  isBot: boolean;
  isReady: boolean;
  isDealer: boolean;
  connected: boolean;
  handOpen: boolean; // открытая — номиналы видны всем; закрытая — рубашки
  handFanned: boolean; // веер на месте (независимо от handOpen)
}

// То же место, но с тем, что нужно нарисовать в его прямоугольнике.
export interface SeatView extends Seat {
  handCount: number;
  /** Порядок карт: нужен для лиц при handOpen (веер или верх стопки). */
  hand: string[];
}

export interface TableSummary {
  total: number; // сидят за столом сейчас
  ready: number;
  bots: number;
}

// Отключённый игрок остаётся в комнате «на паузе» (сервер его не выкидывает), но за
// столом он не сидит — иначе счётчик врёт про то, кто реально в игре.
export function tableSummary(seats: Seat[]): TableSummary {
  const seated = seats.filter((s) => s.connected);
  return {
    total: seated.length,
    ready: seated.filter((s) => s.isReady).length,
    bots: seated.filter((s) => s.isBot).length,
  };
}

// Подпись состава мест: по ней React решает, надо ли перерисовывать стол. Сравнивать
// сами объекты нельзя — RoomScreen пересобирает массив мест на КАЖДЫЙ патч состояния,
// и стол перерисовывался бы (с пересозданием текстов и стопок) по десять раз в секунду.
export function seatsSignature(seats: readonly SeatView[]): string {
  return seats
    .map((s) =>
      [
        s.id,
        s.name,
        s.handCount,
        +s.isReady,
        +s.isDealer,
        +s.connected,
        +s.handOpen,
        +s.handFanned,
        s.hand.join(","),
      ].join(":"),
    )
    .join("|");
}
