import { describe, it, expect } from "vitest";
import { deckPlaceFor } from "./deckZone";

const seated = (ids: string[]) => (id: string) => ids.includes(id);

describe("deckPlaceFor", () => {
  it("'center' — колода на общем столе", () => {
    expect(deckPlaceFor("center", "s1")).toEqual({ zone: "center" });
  });

  it("пустая локация трактуется как центр (страховка на старте)", () => {
    expect(deckPlaceFor("", "s1")).toEqual({ zone: "center" });
  });

  it("колода у меня — значит в руке: другой личной зоны больше нет", () => {
    expect(deckPlaceFor("s1", "s1")).toEqual({ zone: "hand" });
  });

  it("'seat' — колода у другого игрока за столом", () => {
    expect(deckPlaceFor("s2", "s1", seated(["s2"]))).toEqual({ zone: "seat" });
  });

  it("'away' — держатель за столом не сидит, рисовать негде", () => {
    expect(deckPlaceFor("s3", "s1", seated(["s2"]))).toEqual({ zone: "away" });
  });

  it("без списка мест чужая колода — всегда away", () => {
    expect(deckPlaceFor("s2", "s1")).toEqual({ zone: "away" });
  });
});
