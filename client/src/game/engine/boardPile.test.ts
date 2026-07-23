import { describe, expect, it } from "vitest";
import { isPlayPile, playPile, playPileIndex } from "./boardPile";

describe("имена стопок доски", () => {
  it("кучка зоны называется по своему индексу", () => {
    expect(playPile(0)).toBe("play:0");
    expect(playPileIndex(playPile(3))).toBe(3);
  });

  it("колода и сброс кучками зоны не притворяются", () => {
    expect(playPileIndex("deck")).toBeNull();
    expect(playPileIndex("discard")).toBeNull();
    expect(isPlayPile("discard")).toBe(false);
  });

  it("веер не раскрыт — индекса нет", () => {
    expect(playPileIndex(null)).toBeNull();
    expect(playPileIndex(undefined)).toBeNull();
  });

  it("мусор в имени не превращается в кучку номер NaN", () => {
    expect(playPileIndex("play:abc" as never)).toBeNull();
    expect(playPileIndex("play:-1" as never)).toBeNull();
    expect(playPileIndex("play:" as never)).toBeNull();
  });
});
