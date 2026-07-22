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
  handOpen: boolean; // рука открыта — её видно всем так же, как самому игроку
}

// То же место, но с тем, что нужно нарисовать в его прямоугольнике.
export interface SeatView extends Seat {
  handCount: number;
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
