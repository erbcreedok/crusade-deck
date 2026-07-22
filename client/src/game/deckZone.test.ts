import { describe, it, expect } from "vitest";
import { deckZoneFor } from "./deckZone";

const seated = (ids: string[]) => (id: string) => ids.includes(id);

describe("deckZoneFor", () => {
  it("'center' — колода в общем центре", () => {
    expect(deckZoneFor("center", "s1", seated([]))).toBe("center");
  });

  it("пустая локация трактуется как центр (страховка на старте)", () => {
    expect(deckZoneFor("", "s1", seated([]))).toBe("center");
  });

  it("'safe' — колода в моей сейф-зоне (локация == мой sessionId)", () => {
    expect(deckZoneFor("s1", "s1", seated([]))).toBe("safe");
  });

  it("'seat' — колода на месте другого игрока за столом (место теперь нарисовано)", () => {
    expect(deckZoneFor("s2", "s1", seated(["s2"]))).toBe("seat");
  });

  it("'away' — держатель за столом не сидит (вышел): колоду рисовать негде", () => {
    expect(deckZoneFor("s3", "s1", seated(["s2"]))).toBe("away");
  });

  it("без списка мест ведёт себя по-старому: чужая зона = away", () => {
    expect(deckZoneFor("s2", "s1")).toBe("away");
  });
});
