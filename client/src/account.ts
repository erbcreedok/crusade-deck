import { useCallback, useEffect, useRef, useState } from "react";
import { sessionEntry } from "./sessionEntry";
import { addRecent, forgetRecent, loadRecent, saveRecent, type RecentAccount } from "./recentAccounts";

export interface Account {
  id: string;
  name: string;
  recoveryHash: string;
}

export const STORAGE_KEY = "crusade-deck:account";
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

export function useAccount() {
  // Ссылка переноса сессии: код уже вычищен из URL синхронно (sessionEntry). Пока он есть,
  // стартуем в «загрузке» и НЕ показываем локальный аккаунт — сейчас восстановим нужный.
  const transferCode = sessionEntry().transferCode;
  const [account, setAccount] = useState<Account | null>(() => (transferCode ? null : loadLocal()));
  const [loading, setLoading] = useState(!!transferCode);
  const transferredRef = useRef(false);
  const [recentAccounts, setRecentAccounts] = useState<RecentAccount[]>(() => loadRecent());

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

  // Перенос сессии: восстановить аккаунт по коду из ссылки — один раз, поверх локального.
  // Код устарел (юзер обновил код восстановления) — откатываемся на локальный аккаунт.
  useEffect(() => {
    if (!transferCode || transferredRef.current) return;
    transferredRef.current = true;
    restore(transferCode).catch(() => {
      setAccount(loadLocal());
      setLoading(false);
    });
  }, [transferCode, restore]);

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

  // Не трогает общий `loading` — это флаг для начального экрана входа,
  // а не для фоновых операций уже вошедшего пользователя (иначе всё
  // приложение на миг размонтируется в "Загрузка..." и меню теряет state).
  const regenerateCode = useCallback(async () => {
    if (!account) return;
    const res = await fetch(`${SERVER_URL}/accounts/${account.id}/regenerate-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recoveryHash: account.recoveryHash }),
    });
    if (!res.ok) throw new Error("Не удалось обновить код");
    const updated: Account = await res.json();
    saveLocal(updated);
    setAccount(updated);
    return updated;
  }, [account]);

  // Выход: текущий аккаунт остаётся в «недавних» (быстрый вход по его коду), активный —
  // забывается. Возврат на экран входа делает уже App (account стал null).
  const logout = useCallback(() => {
    if (account) {
      const next = addRecent(loadRecent(), account);
      saveRecent(next);
      setRecentAccounts(next);
    }
    localStorage.removeItem(STORAGE_KEY);
    setAccount(null);
    setLoading(false);
  }, [account]);

  // Убрать аккаунт из быстрого доступа (крестик на экране входа).
  const forgetAccount = useCallback((id: string) => {
    setRecentAccounts((cur) => {
      const next = forgetRecent(cur, id);
      saveRecent(next);
      return next;
    });
  }, []);

  return { account, loading, createNew, restore, rename, regenerateCode, logout, recentAccounts, forgetAccount };
}
