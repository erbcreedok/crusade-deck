import { Client, Room } from "colyseus.js";

const client = new Client(import.meta.env.VITE_SERVER_URL || "ws://localhost:2567");
const HTTP_URL = import.meta.env.VITE_HTTP_URL || "http://localhost:2567";

export async function joinRoom(opts: {
  accountId?: string;
  name: string;
  deckType: "36" | "52";
  isPrivate?: boolean;
}): Promise<Room> {
  return client.create("card_room", opts);
}

// Тестовая комната: за столом сразу сидят боты (сервер, TestRoom). Нужна, чтобы делать
// посадку/вёрстку/дроп-зоны, не собирая живых игроков. Всегда приватная — код выдаёт сервер.
export async function createTestRoom(opts: {
  accountId?: string;
  name: string;
  deckType: "36" | "52";
}): Promise<Room> {
  return client.create("test_room", opts);
}

export async function joinRoomById(
  roomId: string,
  opts: { accountId?: string; name: string }
): Promise<Room> {
  return client.joinById(roomId, opts);
}

export async function joinByInviteCode(
  code: string,
  opts: { accountId?: string; name: string }
): Promise<Room> {
  const res = await fetch(`${HTTP_URL}/rooms/by-code/${code}`);
  if (!res.ok) throw new Error("Комната с таким кодом не найдена");
  const { roomId } = await res.json();
  return joinRoomById(roomId, opts);
}

export interface PublicRoomInfo {
  roomId: string;
  deckType: "36" | "52";
  playerCount: number;
}

export async function fetchPublicRooms(): Promise<PublicRoomInfo[]> {
  const res = await fetch(`${HTTP_URL}/rooms/public`);
  if (!res.ok) return [];
  return res.json();
}

export interface LastRoomInfo {
  roomId: string;
  inviteCode: string;
  deckType: "36" | "52";
}

// Последняя посещённая аккаунтом комната (сервер помнит, пока она жива). null — если
// нет/комната уже исчезла. Возврат делается через joinRoomById(roomId, ...).
export async function fetchLastRoom(accountId: string): Promise<LastRoomInfo | null> {
  const res = await fetch(`${HTTP_URL}/accounts/${accountId}/last-room`);
  if (!res.ok) return null;
  return res.json();
}
