import { DEALER_VOTE_WEIGHT } from "./handRules.js";

// Подсчёт голосования. Раньше эти три почти одинаковых цикла жили прямо в CardRoom
// (tallyAndResolve, forceResolveOnTimeout, totalWeight) — чистая арифметика без схемы.

export interface VoterLike {
  isDealer: boolean;
  /** Отключённый игрок «на паузе» — его голос не считается. */
  connected: boolean;
}

export function weightOf(voter: VoterLike | undefined): number {
  if (!voter || !voter.connected) return 0;
  return voter.isDealer ? DEALER_VOTE_WEIGHT : 1;
}

/** Суммарный вес всех, кто может голосовать. */
export function totalWeight(voters: Iterable<VoterLike>): number {
  let total = 0;
  for (const v of voters) total += weightOf(v);
  return total;
}

export interface Tally {
  yes: number;
  no: number;
}

export function tally(votes: Iterable<[string, boolean]>, voterOf: (sessionId: string) => VoterLike | undefined): Tally {
  let yes = 0;
  let no = 0;
  for (const [sessionId, value] of votes) {
    const w = weightOf(voterOf(sessionId));
    if (value) yes += w;
    else no += w;
  }
  return { yes, no };
}

export type VoteOutcome = "passed" | "failed" | "pending";

/**
 * Исход голосования по текущему раскладу.
 * Принято — строгое большинство ВСЕГО веса стола (молчуны считаются против).
 * Отклонено — против набралось столько, что большинство «за» уже недостижимо.
 */
export function outcome(t: Tally, total: number): VoteOutcome {
  if (total > 0 && t.yes > total / 2) return "passed";
  if (t.no >= total / 2) return "failed";
  return "pending";
}

/**
 * Исход по таймауту: кто не успел проголосовать, просто не учитывается — как в
 * большинстве онлайн-игр. Считаем только поданные голоса.
 */
export function outcomeOnTimeout(t: Tally): boolean {
  return t.yes > t.no;
}
