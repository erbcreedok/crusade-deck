import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAccount } from "./account";

const STORAGE_KEY = "crusade-deck:account";

function mockFetchOnce(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      json: async () => body,
    })
  );
}

describe("useAccount", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts with no account when localStorage is empty", () => {
    const { result } = renderHook(() => useAccount());
    expect(result.current.account).toBeNull();
  });

  it("loads a previously saved account from localStorage on mount", () => {
    const saved = { id: "1", name: "Alice", recoveryHash: "ABCDEF" };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));

    const { result } = renderHook(() => useAccount());

    expect(result.current.account).toEqual(saved);
  });

  it("createNew() stores the created account and persists it", async () => {
    const created = { id: "2", name: "Bob", recoveryHash: "GHIJKL" };
    mockFetchOnce(created);

    const { result } = renderHook(() => useAccount());
    await act(async () => {
      await result.current.createNew("Bob");
    });

    expect(result.current.account).toEqual(created);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(created);
  });

  it("restore() throws and leaves the account unset when the code is unknown", async () => {
    mockFetchOnce({ error: "not_found" }, false);

    const { result } = renderHook(() => useAccount());
    await expect(
      act(async () => {
        await result.current.restore("ZZZZZZ");
      })
    ).rejects.toThrow();

    expect(result.current.account).toBeNull();
  });

  it("rename() updates optimistically before the server responds", async () => {
    const saved = { id: "1", name: "Alice", recoveryHash: "ABCDEF" };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    mockFetchOnce({ ...saved, name: "Alicia" });

    const { result } = renderHook(() => useAccount());
    act(() => {
      result.current.rename("Alicia");
    });

    // Оптимистичное обновление происходит синхронно, до ответа сервера.
    expect(result.current.account?.name).toBe("Alicia");
    await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).name).toBe("Alicia"));
  });

  it("regenerateCode() does not toggle the shared `loading` flag", async () => {
    const saved = { id: "1", name: "Alice", recoveryHash: "ABCDEF" };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    mockFetchOnce({ ...saved, recoveryHash: "ZYXWVU" });

    const { result } = renderHook(() => useAccount());

    const regenerate = act(async () => {
      await result.current.regenerateCode();
    });

    // Пока запрос летит, loading НЕ должен становиться true — иначе всё
    // приложение на миг показывает "Загрузка..." (регресс, который уже
    // однажды ловили — см. project_accounts_dealer_voting.md).
    expect(result.current.loading).toBe(false);
    await regenerate;

    expect(result.current.account?.recoveryHash).toBe("ZYXWVU");
    expect(result.current.loading).toBe(false);
  });
});
