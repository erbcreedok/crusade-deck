// Комната живёт на саброуте /room/<код>. Плюс клиентский персист «активной комнаты»,
// чтобы при загрузке страницы бесшовно вернуться туда, где был (без нажатия кнопки).
// Явный выход из комнаты этот персист чистит — тогда авто-возврата нет (но серверная
// «последняя комната» для кнопки в лобби остаётся).

const ACTIVE_ROOM_KEY = "crusade-deck:active-room";

// Достаёт код комнаты из пути (/room/213456 → "213456"), иначе null.
export function parseRoomCode(path: string = window.location.pathname): string | null {
  const m = path.match(/^\/room\/([A-Za-z0-9]+)\/?$/);
  return m ? m[1] : null;
}

export function pushRoomUrl(code: string): void {
  const path = `/room/${code}`;
  if (window.location.pathname !== path) window.history.pushState({}, "", path);
}

export function pushLobbyUrl(): void {
  if (window.location.pathname !== "/") window.history.pushState({}, "", "/");
}

export function saveActiveRoom(code: string): void {
  try {
    localStorage.setItem(ACTIVE_ROOM_KEY, code);
  } catch {
    // localStorage недоступен (приватный режим и т.п.) — не критично
  }
}

export function loadActiveRoom(): string | null {
  return localStorage.getItem(ACTIVE_ROOM_KEY);
}

export function clearActiveRoom(): void {
  localStorage.removeItem(ACTIVE_ROOM_KEY);
}
