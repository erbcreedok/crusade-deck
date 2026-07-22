// Повтор подключения к комнате. Нужен из-за «спящего» сервера: на бесплатных/дешёвых
// хостингах машина засыпает при простое, и ПЕРВАЯ попытка входа её будит, но сама
// обрывается — HTTP-матчмейкинг успевает пройти, а WebSocket упирается в машину,
// которая ещё поднимается («socket hang up»). Вторая попытка через пару секунд
// проходит нормально.
//
// Полезно и без спящего сервера: мобильная сеть роняет первый коннект регулярно.

export interface RetryOptions {
  attempts?: number; // сколько раз пробуем ВСЕГО (включая первую попытку)
  delayMs?: number; // пауза перед повтором; растёт линейно с номером попытки
  sleep?: (ms: number) => Promise<void>; // подменяется в тестах
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 1200;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function retryJoin<T>(join: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? DEFAULT_ATTEMPTS);
  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;
  const sleep = opts.sleep ?? realSleep;

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await join();
    } catch (e) {
      lastError = e;
      // «Комнаты нет» и прочие смысловые отказы повторять бессмысленно — только сетевые.
      if (!isRetriable(e) || i === attempts - 1) throw e;
      await sleep(delayMs * (i + 1));
    }
  }
  throw lastError;
}

// Что имеет смысл повторять: обрыв сокета/сети, а не «код не найден» и не «комната
// заполнена» — на такие ответы повтор даст тот же результат и только потратит время.
export function isRetriable(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e ?? "")).toLowerCase();
  if (!msg) return true; // пустая ошибка — почти всегда оборванный сокет
  return (
    msg.includes("hang up") ||
    msg.includes("socket") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("failed to fetch") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504")
  );
}
