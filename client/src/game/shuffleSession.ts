// Сессия тасовки: клиент считает и анимирует порядок сам, а в сеть шлёт start → редкий
// прогресс → финал. Здесь только протокольная машина (чистая, с временем снаружи) —
// отправку делает React-слой, движок о сети ничего не знает.
//
// Почему throttle, а не debounce: debounce «проглотил» бы всё до конца жеста, и другие
// игроки узнали бы о тасовке только постфактум. Нужен ведущий фронт (первое изменение
// уходит сразу) + не чаще раза в интервал + гарантированный финал по затишью.

export const SHUFFLE_PROGRESS_MS = 500; // не чаще 2 обновлений в секунду
export const SHUFFLE_IDLE_MS = 700; // столько тишины — и жест считается законченным

export interface PushResult {
  start: boolean; // это первое изменение сессии — надо открыть её на сервере
  send: string[] | null; // порядок, который следует отправить прямо сейчас
}

export interface TickResult {
  send: string[] | null;
  final: boolean; // отправить как финал и закрыть сессию
}

export class ShuffleSession {
  private open = false;
  private pending: string[] | null = null; // накопленный, ещё не отправленный порядок
  private last: string[] | null = null; // последний известный порядок (уйдёт финалом)
  private lastSentAt = 0;
  private lastChangeAt = 0;

  constructor(
    private readonly progressMs = SHUFFLE_PROGRESS_MS,
    private readonly idleMs = SHUFFLE_IDLE_MS,
  ) {}

  // Порядок изменился (свайп, кнопка, любой будущий жест).
  push(order: string[], now: number): PushResult {
    const start = !this.open;
    this.open = true;
    this.last = order;
    this.lastChangeAt = now;
    // Ведущий фронт: первое изменение уходит сразу, дальше — не чаще интервала.
    if (start || now - this.lastSentAt >= this.progressMs) {
      this.pending = null;
      this.lastSentAt = now;
      return { start, send: order };
    }
    this.pending = order;
    return { start, send: null };
  }

  // Отменить сессию: накопленный, но ещё не отправленный порядок выбрасывается. Нужен,
  // когда сервер отказал — досылать следом устаревшие изменения бессмысленно и вредно.
  cancel(): void {
    this.open = false;
    this.pending = null;
    this.last = null;
  }

  // Дёргается таймером: отпускает накопленный прогресс и закрывает сессию по затишью.
  tick(now: number): TickResult {
    if (!this.open) return { send: null, final: false };
    if (now - this.lastChangeAt >= this.idleMs) {
      const order = this.last;
      this.open = false;
      this.pending = null;
      this.last = null;
      return { send: order, final: true }; // финал шлём всегда — им закрывается «замок»
    }
    if (this.pending && now - this.lastSentAt >= this.progressMs) {
      const order = this.pending;
      this.pending = null;
      this.lastSentAt = now;
      return { send: order, final: false };
    }
    return { send: null, final: false };
  }
}
