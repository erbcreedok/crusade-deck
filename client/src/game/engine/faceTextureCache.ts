// Кэш лицевых текстур карт + фоновой «прогрев».
//
// Лица генерятся лениво, и первый же переворот требовал их все сразу — 36–52 генерации
// в одном кадре давали заметный «тупняк» именно на ПЕРВОМ перевороте. Поэтому греем их
// заранее, маленькими порциями между кадрами.
//
// Класс намеренно не знает про Pixi (параметр типа T): так его можно проверять тестами,
// не поднимая WebGL. Фабрику и удаление текстуры отдаёт движок.

/** Сколько текстур печём за один заход прогрева (чтобы не проседал кадр). */
const WARM_BATCH = 3;
/** Пауза между заходами прогрева, мс — примерно кадр. */
const WARM_INTERVAL_MS = 16;

type Schedule = (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
type CancelSchedule = (id: ReturnType<typeof setTimeout>) => void;

/** Вариант текстуры лица помимо самой карты: палитра и вид лица. Всё, что меняет картинку. */
type Variant = string;

export interface FaceTextureCacheOptions<T> {
  /** Испечь текстуру лица карты. */
  make: (card: string, fourColor: boolean, style?: string) => T;
  /** Освободить текстуру (у Pixi — tex.destroy(true)). */
  destroy: (tex: T) => void;
  /** Подмена таймера для тестов. */
  schedule?: Schedule;
  cancel?: CancelSchedule;
}

export class FaceTextureCache<T> {
  private cache = new Map<string, T>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly make: (card: string, fourColor: boolean, style?: string) => T;
  private readonly destroyTex: (tex: T) => void;
  private readonly schedule: Schedule;
  private readonly cancel: CancelSchedule;

  constructor(opts: FaceTextureCacheOptions<T>) {
    this.make = opts.make;
    this.destroyTex = opts.destroy;
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = opts.cancel ?? ((id) => clearTimeout(id));
  }

  /**
   * Ключ учитывает палитру И вид лица: одна карта в разных настройках — разные текстуры.
   * Иначе смена «крупный значок ⇄ пипсы» показывала бы старую запечённую картинку.
   */
  private key(card: string, fourColor: boolean, style?: Variant): string {
    return `${card}|${fourColor ? 1 : 0}|${style ?? ""}`;
  }

  has(card: string, fourColor: boolean, style?: Variant): boolean {
    return this.cache.has(this.key(card, fourColor, style));
  }

  get(card: string, fourColor: boolean, style?: Variant): T {
    const key = this.key(card, fourColor, style);
    let tex = this.cache.get(key);
    if (!tex) {
      tex = this.make(card, fourColor, style);
      this.cache.set(key, tex);
    }
    return tex;
  }

  /**
   * Испечь недостающие лица порциями. Повторный вызов, пока идёт прогрев, игнорируется —
   * очередь и так дойдёт до конца, а перезапуск только сбрасывал бы прогресс.
   */
  warm(cards: readonly string[], fourColor: boolean, alive: () => boolean = () => true, style?: Variant): void {
    if (this.timer !== null) return;
    const queue = cards.filter((c) => !this.has(c, fourColor, style));
    if (queue.length === 0) return;
    let i = 0;
    const step = (): void => {
      this.timer = null;
      if (!alive()) return;
      for (let k = 0; k < WARM_BATCH && i < queue.length; k++, i++) this.get(queue[i]!, fourColor, style);
      if (i < queue.length) this.timer = this.schedule(step, WARM_INTERVAL_MS);
    };
    this.timer = this.schedule(step, 0);
  }

  /** Остановить прогрев и освободить все текстуры (вызывается из destroy движка). */
  clear(): void {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.cache.forEach((t) => this.destroyTex(t));
    this.cache.clear();
  }

  /** Только для тестов/диагностики: сколько текстур сейчас в кэше. */
  get size(): number {
    return this.cache.size;
  }
}
