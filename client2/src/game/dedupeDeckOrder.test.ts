import { describe, it, expect } from "vitest";
import { dedupeDeckOrder } from "./dedupeDeckOrder";

describe("dedupeDeckOrder", () => {
  it("убирает повторные карты, сохраняя первое вхождение", () => {
    expect(dedupeDeckOrder(["A♠", "2♠", "A♠", "3♠", "2♠"])).toEqual(["A♠", "2♠", "3♠"]);
  });

  it("нормальную колоду не трогает", () => {
    const deck = ["A♠", "2♠", "3♠", "4♠"];
    expect(dedupeDeckOrder(deck)).toEqual(deck);
  });

  it("пустые строки выкидывает", () => {
    expect(dedupeDeckOrder(["A♠", "", "2♠", ""])).toEqual(["A♠", "2♠"]);
  });
});
