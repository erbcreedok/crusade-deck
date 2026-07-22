// Тайминги комнаты. Все читаются ПРИ КАЖДОМ обращении, а не один раз при загрузке
// модуля: тесты подставляют короткие значения через process.env и не ждут реальных
// десяти секунд/тридцати минут.

/** Код закрытия для соединения, которое перехватил новый вход тем же аккаунтом.
 *  4000+ — свободный диапазон WebSocket-кодов для приложения. */
export const TAKEOVER_CODE = 4001;
/** Код закрытия для выгнанного голосованием. */
export const KICK_CODE = 4000;

/** Сколько идёт голосование, прежде чем закрыться принудительно. */
export function getVoteTimeoutMs(): number {
  return envMs("VOTE_TIMEOUT_MS", 10_000);
}

/** Сколько держится «замок» сессии тасовки без вестей от клиента (он мог отвалиться). */
export function getShuffleLockMs(): number {
  return envMs("SHUFFLE_LOCK_MS", 5_000);
}

/** Сколько живёт опустевшая комната перед диспоузом (даёт вернуться «в последнюю игру»). */
export function getEmptyRoomTtlMs(): number {
  return envMs("EMPTY_ROOM_TTL_MS", 30 * 60_000);
}

function envMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
