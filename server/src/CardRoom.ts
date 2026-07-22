// Room/Client берём из @colyseus/core напрямую — именованные экспорты
// из "colyseus" не работают под нативным Node ESM (см. index.ts).
import { Room, Client, Delayed } from "@colyseus/core";
import { GameState, Player, Proposal } from "./GameState.js";
import { verifyFirebaseToken } from "./auth.js";
import { registerInviteCode, releaseInviteCode } from "./inviteCodes.js";
import { findAccountById } from "./accounts.js";
import { setPublicRoom, updatePublicRoomCount, removePublicRoom } from "./publicRooms.js";
import { setLastRoom, clearLastRoomByRoomId } from "./lastRooms.js";
import { moveCard, isPermutationOf } from "./deckOrder.js";
import { flipWholeDeck, flippedFacing } from "./deckFacing.js";
import { sanitizeDeckFx, FxRateLimiter } from "./deckFx.js";

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

// Сколько держится «замок» сессии тасовки без вестей от клиента (он мог отвалиться
// посреди жеста). Читается лениво — ради коротких таймаутов в тестах.
function getShuffleLockMs(): number {
  const fromEnv = Number(process.env.SHUFFLE_LOCK_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 5_000;
}

// Сколько живёт опустевшая комната перед диспоузом (даёт вернуться «в последнюю игру»).
function getEmptyRoomTtlMs(): number {
  const fromEnv = Number(process.env.EMPTY_ROOM_TTL_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 30 * 60_000; // 30 минут
}

export class CardRoom extends Room<GameState> {
  maxClients = 32;
  private proposalTimeout: Delayed | null = null;
  private shuffleLockTimer: Delayed | null = null;
  // Эффекты необязательны, а сервер слабый — поток режем жёстко (см. deckFx.ts).
  private fxLimiter = new FxRateLimiter(10, 1000);
  private disposeTimer: Delayed | null = null;

  onCreate(options: JoinOptions) {
    // Комната не диспоузится сразу при опустошении — держим её живой TTL, чтобы игрок
    // мог вернуться «в последнюю игру» с восстановленными картами (см. disposeTimer).
    this.autoDispose = false;
    this.setState(new GameState());
    this.state.deckType = options.deckType === "52" ? "52" : "36";
    buildDeck(this.state.deckType).forEach((card) => {
      this.state.deck.push(card);
      this.state.faceUp.set(card, false); // свежая колода лежит рубашкой вверх
    });

    if (options.isPrivate) {
      this.state.inviteCode = registerInviteCode(this.roomId);
    }

    this.onMessage("ready", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.isReady = !player.isReady;
    });

    // Начало СЕССИИ тасовки (любой: кнопка, свайп по вееру, будущие жесты). Порядок
    // считает клиент — он же и анимирует, — а сервер держит «замок»: пока сессия открыта,
    // все видят, кто тасует. Замок снимается финальным set_deck_order, уходом игрока или
    // сторожевым таймером (клиент мог закрыть вкладку посреди жеста).
    this.onMessage("shuffle_start", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.isDealer || this.state.phase !== "lobby") return;
      this.state.shufflingBy = client.sessionId;
      this.armShuffleLockTimer();
    });

    // Дилер перетащил одну карту в раскрытом веере на новое место — порядок колоды
    // меняется и СОХРАНЯЕТСЯ (эхо разойдётся всем). Только дилер и только в лобби.
    this.onMessage("reorder_deck", (client, message: { card?: string; to?: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.isDealer || this.state.phase !== "lobby") return;
      const card = message?.card;
      const to = message?.to;
      if (typeof card !== "string" || typeof to !== "number" || !Number.isFinite(to)) return;
      const next = moveCard(this.state.deck.toArray(), card, to);
      next.forEach((c, i) => this.state.deck.setAt(i, c));
    });

    // Переворот колоды целиком: кнопкой (когда колода НЕ в вее­ре) или свайпом по стопке.
    // Порядок реверсится, каждая карта меняет сторону — как у настоящей стопки в руке.
    this.onMessage("flip_deck", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.isDealer || this.state.phase !== "lobby") return;
      const out = flipWholeDeck(this.state.deck.toArray(), this.facingRecord());
      out.order.forEach((c, i) => this.state.deck.setAt(i, c));
      for (const [card, up] of Object.entries(out.facing)) this.state.faceUp.set(card, up);
    });

    // Переворот отдельных карт на месте (жесты по вееру: свайп вниз по карте, случайные
    // перевороты при сильной тасовке). Порядок колоды не трогается.
    this.onMessage("flip_cards", (client, message: { cards?: string[] }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.isDealer || this.state.phase !== "lobby") return;
      const cards = message?.cards;
      if (!Array.isArray(cards) || cards.length === 0) return;
      const next = flippedFacing(this.facingRecord(), cards.filter((c) => typeof c === "string"));
      for (const [card, up] of Object.entries(next)) this.state.faceUp.set(card, up);
    });

    // Эффекты колоды (перевороты/тянучка/рассыпание) — чистое украшение: сервер их не
    // интерпретирует, а лишь чистит, ставит своё время и раздаёт остальным, чтобы у них
    // анимация длилась столько же, сколько у дилера. Состояние приходит отдельно, схемой,
    // и всегда главнее: эффект может опоздать или потеряться — данные от этого не страдают.
    this.onMessage("deck_fx", (client, message: unknown) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.isDealer || this.state.phase !== "lobby") return;
      if (!this.fxLimiter.allow(client.sessionId, Date.now())) return;
      const fx = sanitizeDeckFx(message, Date.now());
      if (!fx) return;
      this.broadcast("deck_fx", fx, { except: client });
    });

    // Готовый порядок колоды от клиента (свайп по вееру: карты выплёскиваются и врезаются
    // обратно). Тасует КЛИЕНТ — так его анимация точна и не ждёт сети; сервер принимает
    // результат, но проверяет, что это именно перестановка текущей колоды.
    this.onMessage("set_deck_order", (client, message: { order?: string[]; final?: boolean }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.isDealer || this.state.phase !== "lobby") return;
      // Чужую сессию не перебиваем: пока колода «в руках» у другого игрока, его порядок
      // главный (замок держится сервером и снимается сам, если тот отвалился).
      if (this.state.shufflingBy && this.state.shufflingBy !== client.sessionId) return;
      const order = message?.order;
      if (!Array.isArray(order) || !order.every((c) => typeof c === "string")) return;
      if (!isPermutationOf(order, this.state.deck.toArray())) return;
      order.forEach((c, i) => this.state.deck.setAt(i, c));
      if (message?.final) this.clearShuffleLock();
      else this.armShuffleLockTimer(); // промежуточный прогресс продлевает сессию
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

    // Уже есть игрок этого аккаунта (на паузе после обрыва ИЛИ висящий) — это ВОЗВРАТ.
    // Переносим его состояние на новый sessionId (рука, дилерство, готовность) и
    // «размораживаем». Один игрок на аккаунт — старую запись убираем.
    const existing = [...this.state.players.entries()].find(
      ([sid, p]) => p.id === accountId && sid !== client.sessionId,
    );
    if (existing) {
      const [oldSid, old] = existing;
      player.name = old.name || player.name;
      ([...old.hand] as string[]).forEach((c) => player.hand.push(c));
      player.isDealer = old.isDealer; // дилер остаётся дилером
      player.isReady = old.isReady;
      if (this.state.deckLocation === oldSid) this.state.deckLocation = client.sessionId;
      this.state.players.delete(oldSid);
    } else {
      player.isDealer = wasEmpty;
    }
    player.connected = true;

    this.state.players.set(client.sessionId, player);
    this.cancelDisposeTimer(); // комната снова активна
    setLastRoom(accountId, {
      roomId: this.roomId,
      inviteCode: this.state.inviteCode,
      deckType: this.state.deckType,
    });
    if (this.state.isPublic) {
      setPublicRoom(this.roomId, { roomId: this.roomId, deckType: this.state.deckType, playerCount: this.state.players.size });
    }
  }

  // Обрыв связи (свернул вкладку, ушёл сон iOS и т.п.) — НЕ выкидываем из комнаты.
  // Игрок остаётся «на паузе» (connected=false), дилерство сохраняется; вернётся —
  // onJoin разморозит его тем же аккаунтом. Комната диспоузится, только если ВСЕ
  // отключились и прошёл TTL пустой комнаты.
  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;
    this.fxLimiter.forget(client.sessionId);
    if (this.state.shufflingBy === client.sessionId) this.clearShuffleLock(); // не оставляем колоду занятой
    this.cancelProposalInvolving(client.sessionId);
    this.tallyAndResolve();
    this.maybeScheduleDisposeTimer();
  }

  onDispose() {
    this.disposeTimer?.clear();
    this.shuffleLockTimer?.clear();
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

  // Сторожевой таймер сессии тасовки: клиент мог закрыть вкладку прямо посреди жеста,
  // и колода осталась бы «занятой» навсегда.
  private facingRecord(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    this.state.faceUp.forEach((up, card) => (out[card] = up));
    return out;
  }

  private armShuffleLockTimer() {
    this.shuffleLockTimer?.clear();
    this.shuffleLockTimer = this.clock.setTimeout(() => this.clearShuffleLock(), getShuffleLockMs());
  }

  private clearShuffleLock() {
    this.shuffleLockTimer?.clear();
    this.shuffleLockTimer = null;
    this.state.shufflingBy = "";
  }

  private dealCards() {
    const connected = [...this.state.players.values()].filter((p) => p.connected);
    if (connected.length === 0) return;
    let i = 0;
    while (this.state.deck.length > 0) {
      const card = this.state.deck.pop();
      if (card) {
        connected[i % connected.length].hand.push(card);
        this.state.faceUp.delete(card); // карта ушла в руку — её сторона в колоде не нужна
      }
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
