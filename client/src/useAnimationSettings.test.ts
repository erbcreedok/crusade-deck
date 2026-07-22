import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAnimationSettings } from "./useAnimationSettings";

const LEVEL_KEY = "crusade-deck:anim-level";
const SPEED_KEY = "crusade-deck:anim-speed";
const SHADOWS_KEY = "crusade-deck:anim-shadows";
const LEGACY_KEY = "crusade-deck:animations-enabled";

function mockMatchMedia(reducedMotion: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reducedMotion }) as unknown as typeof window.matchMedia;
}

describe("useAnimationSettings", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("по умолчанию — полная анимация, скорость 1x, тени вкл, если нет системного предпочтения", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useAnimationSettings());
    expect(result.current.settings).toEqual({ level: "full", speed: 1, shadows: true });
  });

  it("тени включены по умолчанию, setShadows(false) выключает и сохраняет", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useAnimationSettings());
    expect(result.current.settings.shadows).toBe(true);

    act(() => result.current.setShadows(false));

    expect(result.current.settings.shadows).toBe(false);
    expect(localStorage.getItem(SHADOWS_KEY)).toBe("0");
  });

  it("сохранённое '0' → тени выключены на старте", () => {
    mockMatchMedia(false);
    localStorage.setItem(SHADOWS_KEY, "0");
    const { result } = renderHook(() => useAnimationSettings());
    expect(result.current.settings.shadows).toBe(false);
  });

  it("системное «меньше движения» → умеренная (совсем выключить нельзя)", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useAnimationSettings());
    expect(result.current.settings.level).toBe("moderate");
  });

  it("сохранённый уровень важнее системного", () => {
    mockMatchMedia(true);
    localStorage.setItem(LEVEL_KEY, "full");
    const { result } = renderHook(() => useAnimationSettings());
    expect(result.current.settings.level).toBe("full");
  });

  it("миграция со старого boolean-тумблера: 0 → умеренная", () => {
    mockMatchMedia(false);
    localStorage.setItem(LEGACY_KEY, "0");
    const { result } = renderHook(() => useAnimationSettings());
    expect(result.current.settings.level).toBe("moderate");
  });

  it("setLevel/setSpeed меняют и сохраняют значения", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useAnimationSettings());

    act(() => result.current.setLevel("moderate"));
    act(() => result.current.setSpeed(3));

    expect(result.current.settings).toEqual({ level: "moderate", speed: 3, shadows: true });
    expect(localStorage.getItem(LEVEL_KEY)).toBe("moderate");
    expect(localStorage.getItem(SPEED_KEY)).toBe("3");
  });

  it("битые значения в localStorage → безопасные дефолты", () => {
    mockMatchMedia(false);
    localStorage.setItem(LEVEL_KEY, "turbo");
    localStorage.setItem(SPEED_KEY, "7");
    const { result } = renderHook(() => useAnimationSettings());
    expect(result.current.settings).toEqual({ level: "full", speed: 1, shadows: true });
  });
});
