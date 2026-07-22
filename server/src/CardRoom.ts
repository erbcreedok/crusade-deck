// Room/Client берём из @colyseus/core напрямую — именованные экспорты
// из "colyseus" не работают под нативным Node ESM (см. index.ts).
import { Room, Client, Delayed } from "@colyseus/core";
import { GameState, Player, Proposal } from "./GameState.js";
import { verifyFirebaseToken } from "./auth.js";
import { registerInviteCode, releaseInviteCode } from "./inviteCodes.js";
import { findAccountById } from "./accounts.js";
import { setPublicRoom, updatePublicRoomCount, removePublicRoom } from "./publicRooms.js";
import { setLastRoom, clearLastRoomByRoomId } from "./lastRooms.js";

// Снимок состояния игрока по аккаунту — чтобы восстановить руку при повторном входе
// (в т.ч. из нового браузера) после того, как его Player удалён из стейта.
interface AccountSnapshot {
  name: string;
  hand: string[];
  isDealer: boolean;
  hadDeckInSafe: boolean;
}

interface JoinOptions {
  token?: string;
  accountId?: string;
  name?: string;
  deckType?: "36" | "52";
  isPrivate?: boolean;
}

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS_36 = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const RANKS_52 = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

function buildDeck(deckType: "36" | "52"): string[] {
  const ranks = deckType === "52" ? RANKS_52 : RANKS_36;
  const deck: string[] = [];
  for (const suit of SUITS) {
    for (const rank of ranks) deck.push(rank + suit);
  }
  return deck;
}

// Читаем при каждом обращении (а не один раз при загрузке модуля), чтобы
// тесты могли подставить короткий таймаут через process.env без реального
// ожидания 10 секунд.
function getVoteTimeoutMs(): number {
  const fromEnv = Number(process.env.VOTE_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 10_000;
}

// Секунды окна переподключения (allowReconnection). Лениво из env — тесты ставят короткое.
function getReconnectSeconds(): number {
  const fromEnv = Number(process.env.RECONNECT_SECONDS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 30;
}

// Сколько живёт опустевшая комната перед диспоузом (даёт вернуться «в последнюю игру»).
function getEmptyRoomTtlMs(): number {
  const fromEnv = Number(process.env.EMPTY_ROOM_TTL_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 30 * 60_000; // 30 минут
}

export class CardRoom extends Room<GameState> {
  maxClients = 32;
  private proposalTimeout: Delayed | null = null;
  private disposeTimer: Delayed | null = null;
  private accountSnapshots = new Map<string, AccountSnapshot>();

  onCreate(options: JoinOptions) {
    // Комната не диспоузится сразу при опустошении — держим её живой TTL, чтобы игрок
    // мог вернуться «в последнюю игру» с восстановленными картами (см. disposeTimer).
    this.autoDispose = false;
    this.setState(new GameState());
    this.state.deckType = options.deckType === "52" ? "52" : "36";
    buildDeck(this.state.deckType).forEach((card) => this.state.deck.push(card));

    if (options.isPrivate) {
      this.state.inviteCode = registerInviteCode(this.roomId);
    }

    this.onMessage("ready", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.isReady = !player.isReady;
    });

    this.onMessage("shuffle_deck", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.isDealer || this.state.phase !== "lobby") return;
      this.shuffleDeck();
    });

    // Дилер притягивает колоду в свою сейф-зону (zone "safe") или возвращает в
    // центр (zone "center"). Только дилер и только в лобби (во время раздачи).
    // Карты не раздаются — колода целиком меняет зону, рубашкой вверх.
    this.onMessage("move_deck", (client, message: { zone?: "center" | "safe" }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.isDealer || this.state.phase !== "lobby") return;
      if (message?.zone === "safe") this.state.deckLocation = client.sessionId;
      else if (message?.zone === "center") this.state.deckLocation = "center";
    });

    this.onMessage("start_game", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player?.isDealer && this.state.phase === "lobby") {
        this.dealCards();
        this.state.phase = "playing";
      }
    });

    this.onMessage("toggle_public", (client) => {
      // Паблик/приват может переключить любой игрок в комнате.
      if (!this.state.players.has(client.sessionId)) return;
      this.state.isPublic = !this.state.isPublic;
      if (this.state.isPublic) {
        setPublicRoom(this.roomId, {
          roomId: this.roomId,
          deckType: this.state.deckType,
          playerCount: this.state.players.size,
        });
      } else {
        removePublicRoom(this.roomId);
      }
    });

    this.onMessage("propose_dealer", (client) => {
      if (this.state.activeProposal) return;
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isDealer) return;
      this.startProposal("dealer", client.sessionId, client.sessionId);
    });

    this.onMessage("propose_kick", (client, message: { targetSessionId?: string }) => {
      if (this.state.activeProposal) return;
      const targetSessionId = message?.targetSessionId;
      if (
        !targetSessionId ||
        targetSessionId === client.sessionId ||
        !this.state.players.has(targetSessionId)
      ) {
        return;
      }
      this.startProposal("kick", client.sessionId, targetSessionId);
    });

    this.onMessage("vote", (client, message: { value?: boolean }) => {
      const proposal = this.state.activeProposal;
      if (!proposal || typeof message?.value !== "boolean") return;
      if (!this.state.players.has(client.sessionId)) return;
      proposal.votes.set(client.sessionId, message.value);
      this.tallyAndResolve();
    });
  }

  async onAuth(client: Client, options: JoinOptions) {
    if (options.accountId && findAccountById(options.accountId)) {
      return { uid: options.accountId };
    }
    // На время локальной разработки: если ни аккаунта, ни токена нет, пускаем как гостя.
    if (!options.token) return { uid: `guest-${client.sessionId}` };
    return verifyFirebaseToken(options.token);
  }

  onJoin(client: Client, options: JoinOptions, auth?: { uid: string }) {
    const accountId = auth!.uid;
    const wasEmpty = this.state.players.size === 0;
    const player = new Player();
    player.id = accountId;
    player.name = options.name || "Player";

    // Есть ли прежнее состояние этого аккаунта: (a) ещё висящий отключённый Player
    // (вход из нового браузера в окне переподключения) или (b) сохранённый снапшот.
    const lingering = [...this.state.players.entries()].find(
      ([sid, p]) => p.id === accountId && !p.connected && sid !== client.sessionId,
    );
    const snap = this.accountSnapshots.get(accountId);
    const prior = lingering
      ? { name: lingering[1].name, hand: [...lingering[1].hand] as string[], isDealer: lingering[1].isDealer, oldSid: lingering[0] as string }
      : snap
        ? { name: snap.name, hand: snap.hand, isDealer: snap.isDealer, oldSid: undefined }
        : null;

    if (prior) {
      player.name = prior.name || player.name;
      prior.hand.forEach((c) => player.hand.push(c));
      // Дилерство возвращаем только если сейчас дилера нет — иначе не плодим второго.
      const hasDealer = [...this.state.players.values()].some((p) => p.isDealer);
      player.isDealer = prior.isDealer && !hasDealer;
      // Колода была в сейф-зоне этого игрока — перецепляем на новый sessionId.
      const hadDeckInSafe = lingering ? this.state.deckLocation === prior.oldSid : !!snap?.hadDeckInSafe;
      if (hadDeckInSafe) this.state.deckLocation = client.sessionId;
      if (prior.oldSid) this.state.players.delete(prior.oldSid);
      this.accountSnapshots.delete(accountId);
    } else {
      player.isDealer = wasEmpty;
    }

    this.state.players.set(client.sessionId, player);
    this.cancelDisposeTimer(); // комната снова не пуста
    setLastRoom(accountId, {
      roomId: this.roomId,
      inviteCode: this.state.inviteCode,
      deckType: this.state.deckType,
    });
    if (this.state.isPublic) {
      setPublicRoom(this.roomId, { roomId: this.roomId, deckType: this.state.deckType, playerCount: this.state.players.size });
    }
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;

    if (player.isDealer) {
      const next = [...this.state.players.values()].find((p) => p.connected && p !== player);
      if (next) next.isDealer = true;
    }

    this.cancelProposalInvolving(client.sessionId);
    this.tallyAndResolve();
    this.maybeScheduleDisposeTimer(); // все отключились → завести таймер жизни пустой комнаты

    // Окно переподключения; по его истечении — снапшот состояния и удаление игрока.
    this.allowReconnection(client, getReconnectSeconds())
      .then(() => {
        player.connected = true;
        this.cancelDisposeTimer();
      })
      .catch(() => {
        // Сохраняем руку/дилерство по аккаунту, чтобы восстановить при возврате.
        this.accountSnapshots.set(player.id, {
          name: player.name,
          hand: [...player.hand] as string[],
          isDealer: player.isDealer,
          hadDeckInSafe: this.state.deckLocation === client.sessionId,
        });
        if (this.state.deckLocation === client.sessionId) this.state.deckLocation = "center";
        this.state.players.delete(client.sessionId);
        if (this.state.isPublic) updatePublicRoomCount(this.roomId, this.state.players.size);
        this.maybeScheduleDisposeTimer();
      });
  }

  onDispose() {
    this.disposeTimer?.clear();
    clearLastRoomByRoomId(this.roomId);
    if (this.state.inviteCode) releaseInviteCode(this.state.inviteCode);
    removePublicRoom(this.roomId);
  }

  private connectedCount(): number {
    let n = 0;
    this.state.players.forEach((p) => {
      if (p.connected) n++;
    });
    return n;
  }

  // Нет подключённых игроков → завести таймер диспоуза (комната поживёт TTL для возврата).
  private maybeScheduleDisposeTimer() {
    if (this.connectedCount() > 0 || this.disposeTimer) return;
    if (this.state.isPublic) removePublicRoom(this.roomId); // пустую не светим в списке
    this.disposeTimer = this.clock.setTimeout(() => this.disconnect(), getEmptyRoomTtlMs());
  }

  private cancelDisposeTimer() {
    this.disposeTimer?.clear();
    this.disposeTimer = null;
  }

  private shuffleDeck() {
    const deck = this.state.deck;
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const a = deck.at(i)!;
      const b = deck.at(j)!;
      deck.setAt(i, b);
      deck.setAt(j, a);
    }
  }

  private dealCards() {
    const connected = [...this.state.players.values()].filter((p) => p.connected);
    if (connected.length === 0) return;
    let i = 0;
    while (this.state.deck.length > 0) {
      const card = this.state.deck.pop();
      if (card) connected[i % connected.length].hand.push(card);
      i++;
    }
  }

  private startProposal(kind: "dealer" | "kick", proposerId: string, targetId: string) {
    const proposal = new Proposal();
    proposal.kind = kind;
    proposal.proposerId = proposerId;
    proposal.targetId = targetId;
    const timeoutMs = getVoteTimeoutMs();
    proposal.deadline = Date.now() + timeoutMs;
    proposal.votes.set(proposerId, true);
    this.state.activeProposal = proposal;

    this.proposalTimeout?.clear();
    this.proposalTimeout = this.clock.setTimeout(() => this.forceResolveOnTimeout(), timeoutMs);

    this.tallyAndResolve();
  }

  private cancelProposalInvolving(sessionId: string) {
    const proposal = this.state.activeProposal;
    if (proposal && (proposal.proposerId === sessionId || proposal.targetId === sessionId)) {
      this.proposalTimeout?.clear();
      this.proposalTimeout = null;
      this.state.activeProposal = undefined;
    }
  }

  // Кто не успел проголосовать за отведённое время — просто не учитывается
  // (ни за, ни против), как в голосованиях в большинстве онлайн-игр.
  private forceResolveOnTimeout() {
    const proposal = this.state.activeProposal;
    if (!proposal || !proposal.proposerId) return;

    let yes = 0;
    let no = 0;
    proposal.votes.forEach((value, sessionId) => {
      const weight = this.weightOf(sessionId);
      if (value) yes += weight;
      else no += weight;
    });

    this.resolveProposal(proposal, yes > no);
  }

  private totalWeight(): number {
    let total = 0;
    this.state.players.forEach((p) => {
      if (p.connected) total += p.isDealer ? 1.5 : 1;
    });
    return total;
  }

  private weightOf(sessionId: string): number {
    const p = this.state.players.get(sessionId);
    if (!p || !p.connected) return 0;
    return p.isDealer ? 1.5 : 1;
  }

  private tallyAndResolve() {
    const proposal = this.state.activeProposal;
    if (!proposal) return;

    const total = this.totalWeight();
    let yes = 0;
    let no = 0;
    proposal.votes.forEach((value, sessionId) => {
      const weight = this.weightOf(sessionId);
      if (value) yes += weight;
      else no += weight;
    });

    if (total > 0 && yes > total / 2) {
      this.resolveProposal(proposal, true);
    } else if (no >= total / 2) {
      this.resolveProposal(proposal, false);
    }
  }

  private resolveProposal(proposal: Proposal, passed: boolean) {
    this.proposalTimeout?.clear();
    this.proposalTimeout = null;

    if (passed) {
      if (proposal.kind === "dealer") {
        this.state.players.forEach((p) => (p.isDealer = false));
        const target = this.state.players.get(proposal.targetId);
        if (target) target.isDealer = true;
      } else if (proposal.kind === "kick") {
        const targetClient = this.clients.getById(proposal.targetId);
        this.state.players.delete(proposal.targetId);
        if (this.state.isPublic) updatePublicRoomCount(this.roomId, this.state.players.size);
        targetClient?.leave(4000, "kicked");
      }
    }
    this.state.activeProposal = undefined;
  }
}
