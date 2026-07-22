import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ActionBar, shortenLabel } from "./ActionBar";

afterEach(cleanup);

describe("shortenLabel — подпись всегда влезает в кнопку", () => {
  it("короткую не трогает", () => {
    expect(shortenLabel("Раздать", 12)).toBe("Раздать");
  });

  it("длинную сокращает до предела с многоточием", () => {
    const out = shortenLabel("Перевернуть колоду целиком", 12);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out.endsWith("…")).toBe(true);
  });

  it("не режет по половине слова, если можно обрезать по границе", () => {
    expect(shortenLabel("Вернуть колоду", 10)).toBe("Вернуть…");
  });

  it("пустая подпись остаётся пустой", () => {
    expect(shortenLabel("", 10)).toBe("");
  });
});

describe("ActionBar — постоянный каркас из трёх кнопок", () => {
  it("рисует ровно три слота: главный, второстепенный и гамбургер", () => {
    render(<ActionBar />);
    expect(screen.getAllByRole("button").length).toBe(3);
    expect(screen.getByLabelText("Ещё действия")).toBeTruthy();
  });

  it("без назначенных действий главная и второстепенная кнопки пустые и неактивные", () => {
    render(<ActionBar />);
    const main = screen.getByTestId("action-main");
    const secondary = screen.getByTestId("action-secondary");
    expect(main).toHaveProperty("disabled", true);
    expect(secondary).toHaveProperty("disabled", true);
    expect(main.textContent).toBe("");
  });

  it("назначенное действие включает кнопку и вызывается по клику", () => {
    const onClick = vi.fn();
    render(<ActionBar main={{ label: "Раздать", onClick }} />);
    const main = screen.getByTestId("action-main");
    expect(main).toHaveProperty("disabled", false);
    fireEvent.click(main);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("явный disabled сильнее назначенного действия", () => {
    const onClick = vi.fn();
    render(<ActionBar main={{ label: "Раздать", onClick, disabled: true }} />);
    fireEvent.click(screen.getByTestId("action-main"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("длинная подпись сокращается, но полный текст остаётся в title", () => {
    render(<ActionBar main={{ label: "Перевернуть колоду целиком", onClick: vi.fn() }} />);
    const main = screen.getByTestId("action-main");
    expect(main.textContent!.length).toBeLessThan("Перевернуть колоду целиком".length);
    expect(main.getAttribute("title")).toBe("Перевернуть колоду целиком");
  });
});

describe("ActionBar — слайд-ап меню гамбургера", () => {
  const items = [
    { label: "Настройки", onClick: vi.fn() },
    { label: "Выйти из комнаты", onClick: vi.fn() },
  ];

  it("меню закрыто, пока не нажали гамбургер", () => {
    render(<ActionBar menuItems={items} />);
    expect(screen.queryByText("Настройки")).toBeNull();
  });

  it("гамбургер открывает меню со всеми пунктами", () => {
    render(<ActionBar menuItems={items} />);
    fireEvent.click(screen.getByLabelText("Ещё действия"));
    expect(screen.getByText("Настройки")).toBeTruthy();
    expect(screen.getByText("Выйти из комнаты")).toBeTruthy();
  });

  it("клик по пункту вызывает действие и закрывает меню", () => {
    const onClick = vi.fn();
    render(<ActionBar menuItems={[{ label: "Настройки", onClick }]} />);
    fireEvent.click(screen.getByLabelText("Ещё действия"));
    fireEvent.click(screen.getByText("Настройки"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Настройки")).toBeNull();
  });

  it("клик по затемнению закрывает меню, ничего не вызывая", () => {
    const onClick = vi.fn();
    render(<ActionBar menuItems={[{ label: "Настройки", onClick }]} />);
    fireEvent.click(screen.getByLabelText("Ещё действия"));
    fireEvent.click(screen.getByTestId("action-sheet-backdrop"));
    expect(screen.queryByText("Настройки")).toBeNull();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("гамбургер жив даже без пунктов — каркас постоянный", () => {
    render(<ActionBar />);
    expect(screen.getByLabelText("Ещё действия")).toHaveProperty("disabled", false);
  });
});
