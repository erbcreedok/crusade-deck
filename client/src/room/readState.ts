// Чтение схемы Colyseus в обычные JS-структуры. Отдельным модулем — потому что это
// единственное место, где приходится работать с `any` (схема типизирована на сервере),
// и его хочется проверять тестами на подставном состоянии, а не «на живой комнате».

export interface RoomPlayer {
  id: string;
  name: string;
  isDealer: boolean;
  isReady: boolean;
  isBot: boolean;
  connected: boolean;
  handCount: number;
  hand: string[]; // порядок карт (лица при открытой руке)
  handOpen: boolean; // открытая — номиналы видны всем
  handFanned: boolean; // веер на месте игрока
}

export interface ActiveProposal {
  kind: "dealer" | "kick";
  proposerId: string;
  targetId: string;
  deadline: number;
  votes: Record<string, boolean>;
}

export interface RoomSnapshot {
  players: RoomPlayer[];
  seatOrder: string[];
  inviteCode: string;
  isPublic: boolean;
  phase: "lobby" | "playing" | "finished";
  proposal: ActiveProposal | null;
  /** Номер ревизии колоды: по нему отбрасывается устаревшее эхо. */
  deckRev: number;
  deck: string[];
  /** Сброс: сыгранные карты, лежат лицом вверх. */
  discard: string[];
  facing: Record<string, boolean>;
  deckLocation: string;
  /** Режим свободы: карты со стола игроки берут сами (см. GameState.freeMode). */
  freeMode: boolean;
  deckFanned: boolean;
  /** Рука ЭТОГО игрока в порядке сервера. */
  myHand: string[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export function readPlayers(state: any): RoomPlayer[] {
  const list: RoomPlayer[] = [];
  state.players?.forEach((p: any, sessionId: string) => {
    list.push({
      id: sessionId,
      name: p.name,
      isDealer: !!p.isDealer,
      isReady: !!p.isReady,
      isBot: !!p.isBot,
      connected: !!p.connected,
      handCount: p.hand?.length ?? 0,
      hand: p.hand ? Array.from(p.hand as Iterable<string>) : [],
      handOpen: !!p.handOpen,
      handFanned: !!p.handFanned,
    });
  });
  return list;
}

/**
 * Активное голосование или null.
 *
 * @colyseus/schema всегда отдаёт пустую заглушку для optional nested-schema поля, даже
 * когда оно не установлено на сервере — proposerId остаётся "" до реального старта
 * голосования, и это единственный настоящий признак «нет активного».
 */
export function readProposal(state: any): ActiveProposal | null {
  const ap = state.activeProposal;
  if (!ap || !ap.proposerId) return null;
  const votes: Record<string, boolean> = {};
  ap.votes?.forEach((value: boolean, sessionId: string) => {
    votes[sessionId] = value;
  });
  return { kind: ap.kind, proposerId: ap.proposerId, targetId: ap.targetId, deadline: ap.deadline, votes };
}

export function readFacing(state: any): Record<string, boolean> {
  const facing: Record<string, boolean> = {};
  state.faceUp?.forEach((up: boolean, card: string) => {
    facing[card] = up;
  });
  return facing;
}

export function readRoomState(state: any, sessionId: string): RoomSnapshot {
  const players = readPlayers(state);
  const me = state.players?.get(sessionId);
  return {
    players,
    seatOrder: state.seatOrder ? [...state.seatOrder] : players.map((p) => p.id),
    inviteCode: state.inviteCode ?? "",
    isPublic: !!state.isPublic,
    phase: state.phase ?? "lobby",
    proposal: readProposal(state),
    deckRev: state.deckRev ?? 0,
    deck: state.deck ? [...state.deck] : [],
    discard: state.discard ? [...state.discard] : [],
    facing: readFacing(state),
    deckLocation: state.deckLocation ?? "center",
    freeMode: !!state.freeMode,
    deckFanned: !!state.deckFanned,
    myHand: me?.hand ? [...me.hand] : [],
  };
}
