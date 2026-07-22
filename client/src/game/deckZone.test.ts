import { describe, it, expect } from "vitest";
import { deckZoneFor } from "./deckZone";

describe("deckZoneFor", () => {
  it("'center' — колода в общем центре", () => {
    expect(deckZoneFor("center", "s1")).toBe("center");
  });

  it("пустая локация трактуется как центр (страховка на старте)", () => {
    expect(deckZoneFor("", "s1")).toBe("center");
  });

  it("'safe' — колода в моей сейф-зоне (локация == мой sessionId)", () => {
    expect(deckZoneFor("s1", "s1")).toBe("safe");
  });

  it("'away' — колода в чужой сейф-зоне (пока просто пропала из центра)", () => {
    expect(deckZoneFor("s2", "s1")).toBe("away");
  });
});
