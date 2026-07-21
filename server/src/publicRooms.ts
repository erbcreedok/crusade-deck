export interface PublicRoomInfo {
  roomId: string;
  deckType: "36" | "52";
  playerCount: number;
}

const publicRooms = new Map<string, PublicRoomInfo>();

export function setPublicRoom(roomId: string, info: PublicRoomInfo) {
  publicRooms.set(roomId, info);
}

export function updatePublicRoomCount(roomId: string, playerCount: number) {
  const info = publicRooms.get(roomId);
  if (info) info.playerCount = playerCount;
}

export function removePublicRoom(roomId: string) {
  publicRooms.delete(roomId);
}

export function listPublicRooms(): PublicRoomInfo[] {
  return [...publicRooms.values()];
}
