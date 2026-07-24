import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuthScreen } from "./AuthScreen";

afterEach(cleanup);

const noop = () => Promise.resolve();

describe("AuthScreen", () => {
  it("по умолчанию предлагает завести профиль одной кнопкой", () => {
    render(<AuthScreen onCreate={noop} onRestore={noop} />);
    expect(screen.getByText("Новый профиль")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("BOVAKI")).not.toBeInTheDocument();
  });

  it("создаёт профиль по нажатию", async () => {
    const onCreate = vi.fn(noop);
    render(<AuthScreen onCreate={onCreate} onRestore={noop} />);
    fireEvent.click(screen.getByText("Новый профиль"));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
  });

  it("восстановление скрыто за отдельным шагом и возвращается назад", () => {
    render(<AuthScreen onCreate={noop} onRestore={noop} />);
    fireEvent.click(screen.getByText("Восстановить по коду"));
    expect(screen.getByPlaceholderText("BOVAKI")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Назад"));
    expect(screen.queryByPlaceholderText("BOVAKI")).not.toBeInTheDocument();
  });

  it("отдаёт введённый код восстановления как есть", async () => {
    const onRestore = vi.fn(noop);
    render(<AuthScreen onCreate={noop} onRestore={onRestore} />);
    fireEvent.click(screen.getByText("Восстановить по коду"));
    fireEvent.change(screen.getByPlaceholderText("BOVAKI"), { target: { value: "BOVAKI" } });
    fireEvent.click(screen.getByText("Войти"));
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith("BOVAKI"));
  });

  it("ошибку показывает текстом — сказать «код не подошёл» больше негде", async () => {
    const onRestore = () => Promise.reject(new Error("Код не найден"));
    render(<AuthScreen onCreate={noop} onRestore={onRestore} />);
    fireEvent.click(screen.getByText("Восстановить по коду"));
    fireEvent.click(screen.getByText("Войти"));
    expect(await screen.findByText("Код не найден")).toBeInTheDocument();
  });

  it("успешная попытка гасит прежнюю ошибку", async () => {
    let fail = true;
    const onCreate = () => (fail ? Promise.reject(new Error("Сеть недоступна")) : Promise.resolve());
    render(<AuthScreen onCreate={onCreate} onRestore={noop} />);
    fireEvent.click(screen.getByText("Новый профиль"));
    expect(await screen.findByText("Сеть недоступна")).toBeInTheDocument();

    fail = false;
    fireEvent.click(screen.getByText("Новый профиль"));
    await waitFor(() => expect(screen.queryByText("Сеть недоступна")).not.toBeInTheDocument());
  });
});
