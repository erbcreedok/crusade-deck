import { useCallback, useState } from "react";

export interface Account {
  id: string;
  name: string;
  recoveryHash: string;
}

const STORAGE_KEY = "crusade-deck:account";
const SERVER_URL = import.meta.env.VITE_HTTP_URL || "http://localhost:2567";

function loadLocal(): Account | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Account;
  } catch {
    return null;
  }
}

function saveLocal(account: Account) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
}

// Формат для отображения/копирования: "A1B2-C3D4-E5F6-A7B8-C9D0".
export function formatRecoveryHash(hash: string): string {
  return hash.match(/.{1,4}/g)?.join("-") ?? hash;
}

export function useAccount() {
  const [account, setAccount] = useState<Account | null>(() => loadLocal());
  const [loading, setLoading] = useState(false);

  const createNew = useCallback(async (name?: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Не удалось создать профиль");
      const created: Account = await res.json();
      saveLocal(created);
      setAccount(created);
      return created;
    } finally {
      setLoading(false);
    }
  }, []);

  const restore = useCallback(async (recoveryHash: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/accounts/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryHash }),
      });
      if (!res.ok) throw new Error("Код не найден");
      const restored: Account = await res.json();
      saveLocal(restored);
      setAccount(restored);
      return restored;
    } finally {
      setLoading(false);
    }
  }, []);

  const rename = useCallback(
    async (name: string) => {
      if (!account) return;
      const optimistic = { ...account, name };
      saveLocal(optimistic);
      setAccount(optimistic);
      try {
        const res = await fetch(`${SERVER_URL}/accounts/${account.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, recoveryHash: account.recoveryHash }),
        });
        if (res.ok) {
          const updated: Account = await res.json();
          saveLocal(updated);
          setAccount(updated);
        }
      } catch {
        // сервер недоступен — локальное имя всё равно сохранено
      }
    },
    [account]
  );

  return { account, loading, createNew, restore, rename };
}
