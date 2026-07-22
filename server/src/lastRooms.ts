// Память «последней посещённой комнаты» на аккаунт — чтобы в главном меню показать
// кнопку «вернуться в <код>». In-memory (как publicRooms/inviteCodes): рестарт сервера
// стирает, но комнаты и так живут только в ОЗУ. Инвариант: запись существует ⇔ комната
// ещё жива — чистится в CardRoom.onDispose (clearLastRoomByRoomId).
export interface LastRoomInfo {
  roomId: string;
  inviteCode: string;
  deckType: "36" | "52";
}

const lastRooms = new Map<string, LastRoomInfo>();

export function setLastRoom(accountId: string, info: LastRoomInfo) {
  lastRooms.set(accountId, info);
}

export function getLastRoom(accountId: string): LastRoomInfo | undefined {
  return lastRooms.get(accountId);
}

export function clearLastRoom(accountId: string) {
  lastRooms.delete(accountId);
}

// Убрать записи всех аккаунтов, указывающих на исчезнувшую комнату (её диспоуз).
export function clearLastRoomByRoomId(roomId: string) {
  for (const [accountId, info] of lastRooms) {
    if (info.roomId === roomId) lastRooms.delete(accountId);
  }
}
