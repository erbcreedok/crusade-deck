import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFourColor } from "./useFourColor";

const KEY = "crusade-deck:four-color";

describe("useFourColor", () => {
  beforeEach(() => localStorage.clear());

  it("по умолчанию выключена", () => {
    const { result } = renderHook(() => useFourColor());
    expect(result.current.fourColor).toBe(false);
  });

  it("включение сохраняется в localStorage", () => {
    const { result } = renderHook(() => useFourColor());
    act(() => result.current.setFourColor(true));
    expect(result.current.fourColor).toBe(true);
    expect(localStorage.getItem(KEY)).toBe("1");
  });

  it("сохранённое '1' → включена на старте", () => {
    localStorage.setItem(KEY, "1");
    const { result } = renderHook(() => useFourColor());
    expect(result.current.fourColor).toBe(true);
  });
});
