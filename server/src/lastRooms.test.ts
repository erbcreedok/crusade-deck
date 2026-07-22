import { describe, it, expect } from "vitest";
import { setLastRoom, getLastRoom, clearLastRoom, clearLastRoomByRoomId } from "./lastRooms.js";

describe("lastRooms", () => {
  it("stores and returns the last room for an account", () => {
    setLastRoom("acc-1", { roomId: "room-a", inviteCode: "123456", deckType: "36" });
    expect(getLastRoom("acc-1")).toEqual({ roomId: "room-a", inviteCode: "123456", deckType: "36" });
  });

  it("keeps only the latest room per account (overwrites)", () => {
    setLastRoom("acc-2", { roomId: "room-a", inviteCode: "111111", deckType: "36" });
    setLastRoom("acc-2", { roomId: "room-b", inviteCode: "222222", deckType: "52" });
    expect(getLastRoom("acc-2")?.roomId).toBe("room-b");
  });

  it("returns undefined for an account with no last room", () => {
    expect(getLastRoom("never-seen")).toBeUndefined();
  });

  it("clears one account's last room", () => {
    setLastRoom("acc-3", { roomId: "room-c", inviteCode: "333333", deckType: "36" });
    clearLastRoom("acc-3");
    expect(getLastRoom("acc-3")).toBeUndefined();
  });

  it("clears every account pointing at a disposed room", () => {
    setLastRoom("acc-4", { roomId: "room-x", inviteCode: "444444", deckType: "36" });
    setLastRoom("acc-5", { roomId: "room-x", inviteCode: "444444", deckType: "36" });
    setLastRoom("acc-6", { roomId: "room-y", inviteCode: "555555", deckType: "52" });
    clearLastRoomByRoomId("room-x");
    expect(getLastRoom("acc-4")).toBeUndefined();
    expect(getLastRoom("acc-5")).toBeUndefined();
    expect(getLastRoom("acc-6")?.roomId).toBe("room-y"); // не тронут
  });
});
