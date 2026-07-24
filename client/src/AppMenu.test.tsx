import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { AppMenu } from "./AppMenu";
import { DEFAULT_ANIMATION_SETTINGS } from "./game/anim/animationSettings";
import type { Account } from "./account";
import { BUILD_INFO } from "./version";

afterEach(cleanup);

const account: Account = { id: "a1", name: "Тест", recoveryHash: "ABC123" };

function renderMenu(overrides: Partial<Parameters<typeof AppMenu>[0]> = {}) {
  return render(
    <AppMenu
      account={account}
      onRename={vi.fn()}
      onRegenerateCode={vi.fn()}
      animation={DEFAULT_ANIMATION_SETTINGS}
      onSetLevel={vi.fn()}
      onSetSpeed={vi.fn()}
      onSetShadows={vi.fn()}
      fourColor={false}
      onSetFourColor={vi.fn()}
      cardBack="ruby"
      onSetCardBack={vi.fn()}
      room={null}
      onLeaveRoom={vi.fn()}
      onLogout={vi.fn()}
      {...overrides}
    />
  );
}

// Кнопка подраздела/скина по подписи (в панели меню кнопок немного, ищем по тексту).
function byText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(text))!;
}

function open(container: HTMLElement) {
  fireEvent.click(container.querySelector(".menu-fab")!);
  return container.querySelector(".modal-overlay") as HTMLElement;
}

describe("AppMenu overlay", () => {
  it("открывает оверлей поверх экрана", () => {
    const { container } = renderMenu();
    expect(open(container)).toBeTruthy();
  });

  // Регресс: раньше меню закрывалось по mousedown (useClickOutside), оверлей
  // размонтировался до click — и клик проваливался на кнопку под ним (ghost-click).
  // Оверлей должен оставаться на нажатие, чтобы перехватывать событие.
  it("НЕ закрывается по mousedown на подложке (оверлей остаётся перекрывать зону)", () => {
    const { container } = renderMenu();
    const overlay = open(container);
    fireEvent.mouseDown(overlay);
    expect(container.querySelector(".modal-overlay")).toBeTruthy();
  });

  it("закрывается по клику на подложку", () => {
    const { container } = renderMenu();
    const overlay = open(container);
    fireEvent.click(overlay);
    expect(container.querySelector(".modal-overlay")).toBeFalsy();
  });

  it("настройки графики живут в подразделе, а не в главном меню", () => {
    const { container } = renderMenu();
    open(container);
    expect(byText(container, "Анимации")).toBeUndefined();

    fireEvent.click(byText(container, "Графика"));
    expect(byText(container, "Квадраторомб")).toBeTruthy();
    expect(byText(container, "Мозаика")).toBeTruthy();
    expect(container.querySelector(".pixel-title")?.textContent).toContain("Графика");
  });

  it("выбор рубашки уходит наверх, текущий скин подсвечен", () => {
    const onSetCardBack = vi.fn();
    const { container } = renderMenu({ cardBack: "ruby", onSetCardBack });
    open(container);
    fireEvent.click(byText(container, "Графика"));

    expect(byText(container, "Квадраторомб").className).toContain("seg-btn-active");
    expect(byText(container, "Мозаика").className).not.toContain("seg-btn-active");

    fireEvent.click(byText(container, "Мозаика"));
    expect(onSetCardBack).toHaveBeenCalledWith("mosaic");
  });

  it("из подраздела можно вернуться в главное меню", () => {
    const { container } = renderMenu();
    open(container);
    fireEvent.click(byText(container, "Графика"));
    fireEvent.click(container.querySelector('[aria-label="Назад"]')!);
    expect(container.querySelector(".pixel-title")?.textContent).toContain("Меню");
  });

  // Версию диктуют в поддержку и сверяют по скриншоту — в меню она должна быть полной
  // (версия со сборкой, коммит, время), а не только номером.
  it("в меню настроек видна подпись сборки", () => {
    const { container } = renderMenu();
    open(container);
    const label = container.querySelector(".pixel-version");
    expect(label?.textContent).toContain(BUILD_INFO.version);
    expect(label?.textContent).toContain(BUILD_INFO.build);
    expect(label?.textContent).toContain(BUILD_INFO.commit);
  });

  it("подпись сборки не появляется, пока меню закрыто", () => {
    const { container } = renderMenu();
    expect(container.querySelector(".pixel-version")).toBeNull();
  });

  it("НЕ закрывается по клику внутри панели", () => {
    const { container } = renderMenu();
    open(container);
    fireEvent.click(container.querySelector(".pixel-panel")!);
    expect(container.querySelector(".modal-overlay")).toBeTruthy();
  });
});
