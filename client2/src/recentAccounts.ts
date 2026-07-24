// «Недавние аккаунты» для быстрого входа после логаута: выйдя, юзер остаётся кнопкой на
// экране входа и заходит обратно одним касанием (по своему коду восстановления, который
// хранится локально). Порядок — свежие сверху, без дублей по id, с ограничением по числу.

export interface RecentAccount {
  id: string;
  name: string;
  recoveryHash: string;
}

const KEY = "crusade-deck:recent-accounts";
const CAP = 4;

// ЧИСТО: поднять аккаунт в начало списка недавних (без дубля по id), обрезать до лимита.
export function addRecent(list: RecentAccount[], acc: RecentAccount): RecentAccount[] {
  const rest = list.filter((a) => a.id !== acc.id);
  return [{ id: acc.id, name: acc.name, recoveryHash: acc.recoveryHash }, ...rest].slice(0, CAP);
}

// ЧИСТО: убрать аккаунт из недавних (крестик в быстром доступе).
export function forgetRecent(list: RecentAccount[], id: string): RecentAccount[] {
  return list.filter((a) => a.id !== id);
}

export function loadRecent(): RecentAccount[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentAccount[]) : [];
  } catch {
    return [];
  }
}

export function saveRecent(list: RecentAccount[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // localStorage недоступен (приватный режим) — не критично
  }
}
