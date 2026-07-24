// Разбор адресной строки ОДИН раз при загрузке страницы: что восстановить и как переписать
// URL, чтобы в нём не осталось кода восстановления.
//
// Два входных сценария живут здесь вместе, потому что оба решаются по URL до первого рендера:
//   1) ПЕРЕНОС СЕССИИ — ссылка вида `origin/#u=КОД`. Код лежит в hash (а не в query): так он
//      не уходит на сервер в referer даже до того, как мы его вычистим. Считываем, отдаём на
//      восстановление аккаунта и СРАЗУ убираем из адреса (history.replaceState). Приземление —
//      мейн-меню под этим юзером.
//   2) ПРИГЛАШЕНИЕ НОВИЧКА — заход по `/room/КОД` без локального аккаунта. Тогда НЕ джойнимся
//      автоматически: срезаем комнату из адреса, а код отдаём в лобби как предзаполнение, чтобы
//      человек сперва увидел выбор профиля и мейн-меню, а потом сам нажал «Войти по коду».
//
// Разбор — ЧИСТАЯ функция planEntry (тестируется без DOM); тонкая обёртка sessionEntry() один
// раз дёргает её на настоящем window и переписывает адрес.

import { STORAGE_KEY } from "./account";

const TRANSFER_PARAM = "u";

function normalizeCode(raw: string): string | null {
  const cleaned = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return cleaned || null;
}

export interface EntryPlan {
  /** Код восстановления из ссылки переноса — восстановить этот аккаунт (иначе null). */
  transferCode: string | null;
  /** Код комнаты для предзаполнения лобби, если новичок зашёл по ссылке-приглашению. */
  invitePrefill: string | null;
  /** Новый адрес (path+search+hash) после вычистки, или null — менять не нужно. */
  newUrl: string | null;
}

/**
 * ЧИСТО: по полному URL и наличию локального аккаунта решает, что считать и как переписать
 * адрес. Код переноса всегда вычищается из hash; комната из пути срезается только для новичка
 * (нет аккаунта и не пришёл код переноса).
 */
export function planEntry(href: string, hasLocalAccount: boolean): EntryPlan {
  const url = new URL(href);
  let transferCode: string | null = null;
  let invitePrefill: string | null = null;
  let changed = false;

  const hashMatch = url.hash.match(/[#&]u=([^&]+)/i);
  if (hashMatch) {
    transferCode = normalizeCode(decodeURIComponent(hashMatch[1]!));
    // Наши ссылки переноса несут в hash только u=КОД, поэтому чистим hash целиком.
    url.hash = "";
    changed = true;
  }

  // Пришёл код переноса — значит аккаунт вот-вот появится: новичком уже не считаем.
  const hasAccount = hasLocalAccount || !!transferCode;
  const room = url.pathname.match(/^\/room\/([A-Za-z0-9]+)\/?$/);
  if (!hasAccount && room) {
    invitePrefill = room[1]!;
    url.pathname = "/";
    changed = true;
  }

  return {
    transferCode,
    invitePrefill,
    newUrl: changed ? url.pathname + url.search + url.hash : null,
  };
}

/** Ссылка переноса сессии: код в hash, путь — корень (приземление в мейн-меню). */
export function buildTransferLink(code: string, origin: string): string {
  return `${origin}/#${TRANSFER_PARAM}=${encodeURIComponent(code)}`;
}

let cached: EntryPlan | null = null;

/**
 * Один раз (кэш) считать план с настоящего window и СРАЗУ переписать адрес — до первого
 * рендера. Дальше useAccount читает transferCode, App — invitePrefill.
 */
export function sessionEntry(): EntryPlan {
  if (cached) return cached;
  try {
    const hasAccount = !!localStorage.getItem(STORAGE_KEY);
    cached = planEntry(window.location.href, hasAccount);
    if (cached.newUrl) window.history.replaceState({}, "", cached.newUrl);
  } catch {
    cached = { transferCode: null, invitePrefill: null, newUrl: null };
  }
  return cached;
}

// Только для тестов: сбросить кэш между кейсами.
export function __resetSessionEntry(): void {
  cached = null;
}
