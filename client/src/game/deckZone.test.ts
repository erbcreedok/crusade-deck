import { describe, it, expect } from "vitest";
import { deckPlaceFor } from "./deckZone";

const seated = (ids: string[]) => (id: string) => ids.includes(id);

describe("deckPlaceFor", () => {
  it("'center' — колода на общем столе", () => {
    expect(deckPlaceFor("center", "", "s1")).toEqual({ zone: "center" });
  });

  it("пустая локация трактуется как центр (страховка на старте)", () => {
    expect(deckPlaceFor("", "", "s1")).toEqual({ zone: "center" });
  });

  it("моя рука — там, где колода станет веером", () => {
    expect(deckPlaceFor("s1", "hand", "s1")).toEqual({ zone: "hand" });
  });

  it("мой сейф — одна зона, без номеров мест", () => {
    expect(deckPlaceFor("s1", "safe", "s1")).toEqual({ zone: "safe" });
  });

  it("мусорное значение у меня не роняет колоду в никуда — это сейф", () => {
    expect(deckPlaceFor("s1", "", "s1")).toEqual({ zone: "safe" });
    expect(deckPlaceFor("s1", "нечто", "s1")).toEqual({ zone: "safe" });
  });

  it("'seat' — колода у другого игрока за столом", () => {
    expect(deckPlaceFor("s2", "safe0", "s1", seated(["s2"]))).toEqual({ zone: "seat" });
  });

  it("'away' — держатель за столом не сидит", () => {
    expect(deckPlaceFor("s3", "safe0", "s1", seated(["s2"]))).toEqual({ zone: "away" });
  });
});
