import { describe, expect, it } from "vitest";
import { addSeat, removeSeat, replaceSeat, seatIdsInOrder } from "./seatRing.js";

describe("addSeat", () => {
  it("дилер садится в голову круга, обычный игрок — в хвост", () => {
    expect(addSeat(["a", "b"], "d", true)).toEqual(["d", "a", "b"]);
    expect(addSeat(["a", "b"], "c", false)).toEqual(["a", "b", "c"]);
  });

  it("повторное добавление ничего не меняет", () => {
    expect(addSeat(["a", "b"], "a", true)).toEqual(["a", "b"]);
  });

  it("не мутирует исходный круг", () => {
    const order = ["a"];
    addSeat(order, "b", false);
    expect(order).toEqual(["a"]);
  });
});

describe("replaceSeat", () => {
  it("вернувшийся игрок садится на СВОЁ прежнее место, а не в хвост", () => {
    expect(replaceSeat(["a", "b", "c"], "b", "b2")).toEqual(["a", "b2", "c"]);
  });

  it("если прежнего места нет — дописываем в хвост", () => {
    expect(replaceSeat(["a"], "нет", "new")).toEqual(["a", "new"]);
  });

  it("не плодит дубликат, если новый sessionId уже в круге", () => {
    expect(replaceSeat(["a", "b"], "нет", "b")).toEqual(["a", "b"]);
  });
});

describe("removeSeat", () => {
  it("убирает игрока, порядок остальных сохраняется", () => {
    expect(removeSeat(["a", "b", "c"], "b")).toEqual(["a", "c"]);
    expect(removeSeat(["a"], "нет")).toEqual(["a"]);
  });
});

describe("seatIdsInOrder", () => {
  it("оставляет только тех, кто реально в комнате", () => {
    expect(seatIdsInOrder(["a", "ушёл", "b"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("выпавший из круга игрок дописывается в хвост, а не теряется", () => {
    expect(seatIdsInOrder(["a"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("пустая комната — пустой круг", () => {
    expect(seatIdsInOrder(["a"], [])).toEqual([]);
  });
});
