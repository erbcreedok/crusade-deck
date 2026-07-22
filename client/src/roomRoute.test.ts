import { describe, it, expect, beforeEach } from "vitest";
import { parseRoomCode, saveActiveRoom, loadActiveRoom, clearActiveRoom } from "./roomRoute";

describe("parseRoomCode", () => {
  it("достаёт код из /room/<код>", () => {
    expect(parseRoomCode("/room/213456")).toBe("213456");
  });

  it("допускает завершающий слэш", () => {
    expect(parseRoomCode("/room/213456/")).toBe("213456");
  });

  it("корень и прочие пути → null", () => {
    expect(parseRoomCode("/")).toBeNull();
    expect(parseRoomCode("/lobby")).toBeNull();
    expect(parseRoomCode("/room/")).toBeNull();
  });
});

describe("активная комната (персист)", () => {
  beforeEach(() => localStorage.clear());

  it("save → load возвращает код", () => {
    saveActiveRoom("987456");
    expect(loadActiveRoom()).toBe("987456");
  });

  it("clear убирает код", () => {
    saveActiveRoom("987456");
    clearActiveRoom();
    expect(loadActiveRoom()).toBeNull();
  });

  it("по умолчанию null", () => {
    expect(loadActiveRoom()).toBeNull();
  });
});
