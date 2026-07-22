// Шина «эффектов» колоды: перевороты, тянучка, рассыпание. Это ТОЛЬКО украшение —
// настоящее состояние (порядок и сторона карт) ходит схемой Colyseus и остаётся
// единственным источником правды. Эффект может опоздать, потеряться или быть отброшенным
// по возрасту — на состояние это не влияет никак.
//
// Сервер здесь: чистит payload, зажимает длительности (клиент не диктует минуты анимации),
// ставит СВОЁ время и режет спам. Длительности приходят от клиента дилера специально —
// чтобы у остальных эффект длился столько же, сколько видел он, а не «сколько дошло».

export const FX_KINDS = ["flip-deck", "flip-cards", "spill", "stretch"] as const;
export type FxKind = (typeof FX_KINDS)[number];

export const FX_MAX_DUR_MS = 2500; // потолок длительности одного эффекта
export const FX_MAX_AGE_MS = 1200; // старше — не проигрываем: момент упущен, и ладно
const FX_MAX_CARDS = 64;
const FX_MAX_COUNT = 16;

export interface DeckFx {
  kind: FxKind;
  angle: number; // направление жеста (рад) — им задаётся ось переворота/тянучки
  cards: string[];
  count: number;
  dur: number; // сколько эффект длился у дилера, мс
  t: number; // серверное время приёма
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function sanitizeDeckFx(raw: unknown, now: number): DeckFx | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const kind = m.kind as FxKind;
  if (!FX_KINDS.includes(kind)) return null;
  const cards = Array.isArray(m.cards)
    ? m.cards.filter((c): c is string => typeof c === "string").slice(0, FX_MAX_CARDS)
    : [];
  return {
    kind,
    angle: num(m.angle),
    cards,
    count: Math.max(0, Math.min(FX_MAX_COUNT, Math.round(num(m.count)))),
    dur: Math.max(0, Math.min(FX_MAX_DUR_MS, num(m.dur))),
    t: now,
  };
}

// Скользящее окно на клиента: сервер слабый, а эффекты — необязательная красота, поэтому
// поток режется жёстко и без сожалений.
export class FxRateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(clientId: string, now: number): boolean {
    const list = (this.hits.get(clientId) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.limit) {
      this.hits.set(clientId, list);
      return false;
    }
    list.push(now);
    this.hits.set(clientId, list);
    return true;
  }

  forget(clientId: string): void {
    this.hits.delete(clientId);
  }
}
