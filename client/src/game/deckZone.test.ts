import { describe, it, expect } from "vitest";
import { deckPlaceFor } from "./deckZone";

const seated = (ids: string[]) => (id: string) => ids.includes(id);

describe("deckPlaceFor", () => {
  it("'center' — колода на общем столе", () => {
    expect(deckPlaceFor("center", "", "s1")).toEqual({ zone: "center", slot: 0 });
  });

  it("пустая локация трактуется как центр (страховка на старте)", () => {
    expect(deckPlaceFor("", "", "s1")).toEqual({ zone: "center", slot: 0 });
  });

  it("моя рука — там, где колода станет веером", () => {
    expect(deckPlaceFor("s1", "hand", "s1")).toEqual({ zone: "hand", slot: 0 });
  });

  it("мой сейф помнит номер слота", () => {
    expect(deckPlaceFor("s1", "safe2", "s1")).toEqual({ zone: "safe", slot: 2 });
  });

  it("мусорный слот у меня не роняет колоду в никуда — первый сейф", () => {
    expect(deckPlaceFor("s1", "", "s1")).toEqual({ zone: "safe", slot: 0 });
    expect(deckPlaceFor("s1", "нечто", "s1")).toEqual({ zone: "safe", slot: 0 });
  });

  it("'seat' — колода у другого игрока за столом", () => {
    expect(deckPlaceFor("s2", "safe0", "s1", seated(["s2"]))).toEqual({ zone: "seat", slot: 0 });
  });

  it("'away' — держатель за столом не сидит", () => {
    expect(deckPlaceFor("s3", "safe0", "s1", seated(["s2"]))).toEqual({ zone: "away", slot: 0 });
  });
});
