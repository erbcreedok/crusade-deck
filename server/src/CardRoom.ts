// Room/Client берём из @colyseus/core напрямую — именованные экспорты
// из "colyseus" не работают под нативным Node ESM (см. index.ts).
import { Room, Client, Delayed } from "@colyseus/core";
import { GameState, Player, Proposal } from "./GameState.js";
import { verifyFirebaseToken } from "./auth.js";
import { registerInviteCode, releaseInviteCode } from "./inviteCodes.js";
import { findAccountById } from "./accounts.js";
import { setPublicRoom, updatePublicRoomCount, removePublicRoom } from "./publicRooms.js";
import { setLastRoom, clearLastRoomByRoomId } from "./lastRooms.js";
import { FxRateLimiter } from "./deckFx.js";
import { buildDeck, normalizeDeckType } from "./deckBuild.js";
import { getEmptyRoomTtlMs, getShuffleLockMs, getVoteTimeoutMs, KICK_CODE, TAKEOVER_CODE } from "./roomConfig.js";
import { addSeat, removeSeat, replaceSeat, seatIdsInOrder } from "./seatRing.js";
import { outcome, outcomeOnTimeout, tally, totalWeight } from "./voteTally.js";
import { writeFreshDeck } from "./stateWrite.js";
import { registerDeckMessages } from "./messages/deckMessages.js";
import { registerHandMessages } from "./messages/handMessages.js";
import { registerRoomMessages } from "./messages/roomMessages.js";
import type { RoomHost } from "./messages/host.js";

interface JoinOptions {
  token?: string;
  accountId?: string;
  name?: string;
  deckType?: "36" | "52";
  isPrivate?: boolean;
}

export class CardRoom extends Room<GameState> implements RoomHost {
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
    this.state.deckType = normalizeDeckType(options.deckType);
    // Свежая колода лежит рубашкой вверх.
    writeFreshDeck(this.state, buildDeck(this.state.deckType));

    if (options.isPrivate) {
      this.state.inviteCode = registerInviteCode(this.roomId);
    }

    // Обработчики сообщений разложены по темам (см. messages/*): колода, руки, комната.
    registerDeckMessages(this);
    registerHandMessages(this);
    registerRoomMessages(this);
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
    // Дилером становится первый ЖИВОЙ игрок. Боты в тестовой комнате уже сидят за столом
    // на момент первого входа — считать по ним «комната не пуста» значит оставить её
    // вообще без дилера (боты дилерами не бывают, см. bots.ts).
    const noHumansYet = ![...this.state.players.values()].some((p) => !p.isBot);
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
      this.replaceSeatOrder(oldSid, client.sessionId);
      // Старое соединение могло быть ещё ЖИВЫМ (перезагрузка страницы успела открыть
      // новый сокет раньше, чем закрылся прежний). Игрока у него уже нет — оставить его
      // висеть значит показать клиенту комнату, в которой его самого нет (и он «не дилер»).
      // Закрываем явно: клиент увидит onLeave и переподключится штатным путём.
      this.clients.find((c) => c.sessionId === oldSid)?.leave(TAKEOVER_CODE);
    } else {
      player.isDealer = noHumansYet;
    }
    if (player.isDealer) player.isReady = true; // дилер всегда готов
    player.connected = true;

    this.state.players.set(client.sessionId, player);
    if (!existing) this.addToSeatOrder(client.sessionId, player.isDealer);
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

  /** Круг мест: правила — в seatRing.ts, здесь только запись в схему. */
  private writeSeatOrder(next: readonly string[]): void {
    this.state.seatOrder.clear();
    next.forEach((id) => this.state.seatOrder.push(id));
  }

  private addToSeatOrder(sessionId: string, asDealer: boolean): void {
    this.writeSeatOrder(addSeat(this.state.seatOrder.toArray(), sessionId, asDealer));
  }

  private replaceSeatOrder(oldSid: string, newSid: string): void {
    this.writeSeatOrder(replaceSeat(this.state.seatOrder.toArray(), oldSid, newSid));
  }

  private removeFromSeatOrder(sessionId: string): void {
    this.writeSeatOrder(removeSeat(this.state.seatOrder.toArray(), sessionId));
  }

  seatIds(): string[] {
    return seatIdsInOrder(this.state.seatOrder.toArray(), [...this.state.players.keys()]);
  }

  // Считаем только живых: боты «подключены» всегда, и если их учитывать, опустевшая
  // тестовая комната никогда не дождётся своего TTL и провисит вечно.
  private connectedCount(): number {
    let n = 0;
    this.state.players.forEach((p) => {
      if (p.connected && !p.isBot) n++;
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

  // Принять запись, только если её номер новее текущего: дилер пишет мгновенно и мог
  // прислать несколько изменений подряд, а порядок доставки не гарантирован. Без номера
  // (старый клиент) считаем запись валидной и двигаем ревизию сами.
  acceptRev(rev: unknown): boolean {
    if (typeof rev !== "number" || !Number.isFinite(rev)) {
      this.state.deckRev += 1;
      return true;
    }
    if (rev <= this.state.deckRev) return false;
    this.state.deckRev = rev;
    return true;
  }

  /** Антифлуд эффектов: сервер слабый, поток режем жёстко (см. deckFx.ts). */
  allowFx(sessionId: string, now: number): boolean {
    return this.fxLimiter.allow(sessionId, now);
  }

  // Сторожевой таймер сессии тасовки: клиент мог закрыть вкладку прямо посреди жеста,
  // и колода осталась бы «занятой» навсегда.
  armShuffleLock() {
    this.shuffleLockTimer?.clear();
    this.shuffleLockTimer = this.clock.setTimeout(() => this.clearShuffleLock(), getShuffleLockMs());
  }

  clearShuffleLock() {
    this.shuffleLockTimer?.clear();
    this.shuffleLockTimer = null;
    this.state.shufflingBy = "";
  }

  /** Раздать всю колоду по кругу (старт игры). */
  dealAllCards() {
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

  startProposal(kind: "dealer" | "kick", proposerId: string, targetId: string) {
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
    this.resolveProposal(proposal, outcomeOnTimeout(this.tallyVotes(proposal)));
  }

  private tallyVotes(proposal: Proposal) {
    return tally(proposal.votes.entries(), (sid) => this.state.players.get(sid));
  }

  tallyAndResolve() {
    const proposal = this.state.activeProposal;
    if (!proposal) return;
    const result = outcome(this.tallyVotes(proposal), totalWeight(this.state.players.values()));
    if (result !== "pending") this.resolveProposal(proposal, result === "passed");
  }

  private resolveProposal(proposal: Proposal, passed: boolean) {
    this.proposalTimeout?.clear();
    this.proposalTimeout = null;

    if (passed) {
      if (proposal.kind === "dealer") {
        this.state.players.forEach((p) => (p.isDealer = false));
        const target = this.state.players.get(proposal.targetId);
        if (target) {
          target.isDealer = true;
          target.isReady = true; // новый дилер сразу готов
        }
      } else if (proposal.kind === "kick") {
        const targetClient = this.clients.getById(proposal.targetId);
        this.state.players.delete(proposal.targetId);
        this.removeFromSeatOrder(proposal.targetId);
        if (this.state.isPublic) updatePublicRoomCount(this.roomId, this.state.players.size);
        targetClient?.leave(KICK_CODE, "kicked");
      }
    }
    this.state.activeProposal = undefined;
  }
}
