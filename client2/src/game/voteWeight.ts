// Вес голосов в предложениях (сменить дилера / выгнать игрока).
//
// Клиент только ПОКАЗЫВАЕТ расклад, решает сервер (server/src/handRules.ts). Поэтому вес
// обязан совпадать с серверным: раньше здесь стояло 1.5, а сервер считал 1.01 — полоска
// в баннере голосования расходилась с тем, чем на самом деле кончится голосование.

/** Дилер лишь решает НИЧЬЮ: двое обычных игроков всегда перевешивают его. */
export const DEALER_VOTE_WEIGHT = 1.01;

export interface VoterLike {
  id: string;
  isDealer: boolean;
  /** Отключённый игрок «на паузе» — его голос не считается. */
  connected: boolean;
}

export function voteWeight(voter: VoterLike | undefined): number {
  if (!voter || !voter.connected) return 0;
  return voter.isDealer ? DEALER_VOTE_WEIGHT : 1;
}

export interface VoteTally {
  yes: number;
  no: number;
  /** Сколько веса вообще есть за столом — знаменатель полоски. */
  total: number;
}

export function tallyVotes(voters: readonly VoterLike[], votes: Record<string, boolean>): VoteTally {
  let yes = 0;
  let no = 0;
  for (const [id, value] of Object.entries(votes)) {
    const w = voteWeight(voters.find((v) => v.id === id));
    if (value) yes += w;
    else no += w;
  }
  const total = voters.reduce((sum, v) => sum + voteWeight(v), 0);
  return { yes, no, total };
}
