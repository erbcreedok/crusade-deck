import { describe, it, expect } from "vitest";
import { setPublicRoom, updatePublicRoomCount, removePublicRoom, listPublicRooms } from "./publicRooms.js";

describe("publicRooms", () => {
  it("lists a room once it's set public", () => {
    setPublicRoom("room-a", { roomId: "room-a", deckType: "36", playerCount: 1 });
    expect(listPublicRooms()).toContainEqual({ roomId: "room-a", deckType: "36", playerCount: 1 });
  });

  it("updates the player count of an already-listed room", () => {
    setPublicRoom("room-b", { roomId: "room-b", deckType: "52", playerCount: 1 });
    updatePublicRoomCount("room-b", 3);
    expect(listPublicRooms().find((r) => r.roomId === "room-b")?.playerCount).toBe(3);
  });

  it("ignores a count update for a room that isn't public", () => {
    updatePublicRoomCount("never-listed", 5);
    expect(listPublicRooms().find((r) => r.roomId === "never-listed")).toBeUndefined();
  });

  it("removes a room from the list", () => {
    setPublicRoom("room-c", { roomId: "room-c", deckType: "36", playerCount: 2 });
    removePublicRoom("room-c");
    expect(listPublicRooms().find((r) => r.roomId === "room-c")).toBeUndefined();
  });
});
