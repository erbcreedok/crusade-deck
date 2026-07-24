import { describe, it, expect, beforeEach } from "vitest";
import { applyThemeColor, THEME_COLORS } from "./themeColor";

function metaContent(): string | null {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? null;
}

describe("applyThemeColor", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  it("ставит цвет комнаты — тот же, что у её фона", () => {
    document.head.innerHTML = '<meta name="theme-color" content="#173d2d" />';
    applyThemeColor("game");
    expect(metaContent()).toBe(THEME_COLORS.game);
  });

  it("возвращает цвет меню при выходе из комнаты", () => {
    document.head.innerHTML = '<meta name="theme-color" content="#333f3a" />';
    applyThemeColor("menu");
    expect(metaContent()).toBe(THEME_COLORS.menu);
  });

  it("создаёт мету, если её нет в документе", () => {
    applyThemeColor("game");
    expect(metaContent()).toBe(THEME_COLORS.game);
    expect(document.querySelectorAll('meta[name="theme-color"]').length).toBe(1);
  });

  it("цвета меню и комнаты различаются — иначе смысла в переключении нет", () => {
    expect(THEME_COLORS.menu).not.toBe(THEME_COLORS.game);
  });
});
