import { describe, it, expect } from "vitest";
import { flipRejectReason } from "./rejections.js";

const dealer = { isDealer: true } as const;
const guest = { isDealer: false } as const;

describe("flipRejectReason", () => {
  it("дилеру в лобби переворот разрешён", () => {
    expect(flipRejectReason(dealer, "lobby", ["A♠"], ["A♠"])).toBeNull();
  });

  it("в режиме раздачи переворот запрещён даже дилеру — номиналов не видит никто", () => {
    expect(flipRejectReason(dealer, "lobby", ["A♠"], ["A♠"], true)).toBe("deal_mode");
    expect(flipRejectReason(dealer, "lobby", ["A♠"], [], true)).toBe("deal_mode");
  });

  it("не дилер — отказ с причиной", () => {
    expect(flipRejectReason(guest, "lobby", ["A♠"], ["A♠"])).toBe("not_dealer");
  });

  it("нет игрока в комнате — отказ", () => {
    expect(flipRejectReason(undefined, "lobby", ["A♠"], ["A♠"])).toBe("not_dealer");
  });

  it("игра уже началась — колоду не переворачивают", () => {
    expect(flipRejectReason(dealer, "playing", ["A♠"], ["A♠"])).toBe("not_lobby");
  });

  it("колода пуста — переворачивать нечего", () => {
    expect(flipRejectReason(dealer, "lobby", [], [])).toBe("empty_deck");
  });

  it("просят карты, которых в колоде нет", () => {
    expect(flipRejectReason(dealer, "lobby", ["A♠"], ["K♦"])).toBe("unknown_cards");
  });

  it("причина «нет дилера» важнее причины «не та фаза» — сообщаем главную", () => {
    expect(flipRejectReason(guest, "playing", ["A♠"], ["A♠"])).toBe("not_dealer");
  });

  it("режим раздачи проверяется после роли: не-дилеру сообщаем про роль", () => {
    expect(flipRejectReason(guest, "lobby", ["A♠"], ["A♠"], true)).toBe("not_dealer");
  });
});
