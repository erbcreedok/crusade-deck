import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCardBack } from "./useCardBack";

const KEY = "crusade-deck:card-back";

describe("useCardBack", () => {
  beforeEach(() => localStorage.clear());

  it("по умолчанию — красно-белый квадраторомб", () => {
    const { result } = renderHook(() => useCardBack());
    expect(result.current.cardBack).toBe("ruby");
  });

  it("выбор сохраняется в localStorage", () => {
    const { result } = renderHook(() => useCardBack());
    act(() => result.current.setCardBack("mosaic"));
    expect(result.current.cardBack).toBe("mosaic");
    expect(localStorage.getItem(KEY)).toBe("mosaic");
  });

  it("сохранённый скин поднимается на старте", () => {
    localStorage.setItem(KEY, "mosaic");
    expect(renderHook(() => useCardBack()).result.current.cardBack).toBe("mosaic");
  });

  it("мусор в localStorage откатывается к скину по умолчанию", () => {
    localStorage.setItem(KEY, "скин-которого-нет");
    expect(renderHook(() => useCardBack()).result.current.cardBack).toBe("ruby");
  });
});
