// Room/Client берём из @colyseus/core напрямую — именованные экспорты
// из "colyseus" не работают под нативным Node ESM (см. index.ts).
import { Room, Client } from "@colyseus/core";
import { GameState, Player, Proposal } from "./GameState.js";
import { verifyFirebaseToken } from "./auth.js";
import { registerInviteCode, releaseInviteCode } from "./inviteCodes.js";
import { findAccountById } from "./accounts.js";
import { setPublicRoom, updatePublicRoomCount, removePublicRoom } from "./publicRooms.js";

interface JoinOptions {
  token?: string;
  accountId?: string;
  name?: string;
  deckType?: "36" | "52";
  isPrivate?: boolean;
}

export class CardRoom extends Room<GameState> {
  maxClients = 32;

  onCreate(options: JoinOptions) {
    this.setState(new GameState());
    this.state.deckType = options.deckType === "52" ? "52" : "36";

    if (options.isPrivate) {
      this.state.inviteCode = registerInviteCode(this.roomId);
    }

    this.onMessage("ready", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.isReady = !player.isReady;
    });

    this.onMessage("start_game", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player?.isDealer && this.state.phase === "lobby") {
        this.state.phase = "playing";
        // TODO: тут будет вызов GameEngine, когда появятся правила игры
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
    const player = new Player();
    player.id = auth!.uid;
    player.name = options.name || "Player";
    player.isDealer = this.state.players.size === 0;
    this.state.players.set(client.sessionId, player);
    if (this.state.isPublic) updatePublicRoomCount(this.roomId, this.state.players.size);
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

    // Даем 30 секунд на переподключение перед тем как выкинуть из комнаты
    this.allowReconnection(client, 30)
      .then(() => {
        player.connected = true;
      })
      .catch(() => {
        this.state.players.delete(client.sessionId);
        if (this.state.isPublic) updatePublicRoomCount(this.roomId, this.state.players.size);
      });
  }

  onDispose() {
    if (this.state.inviteCode) releaseInviteCode(this.state.inviteCode);
    removePublicRoom(this.roomId);
  }

  private startProposal(kind: "dealer" | "kick", proposerId: string, targetId: string) {
    const proposal = new Proposal();
    proposal.kind = kind;
    proposal.proposerId = proposerId;
    proposal.targetId = targetId;
    proposal.votes.set(proposerId, true);
    this.state.activeProposal = proposal;
    this.tallyAndResolve();
  }

  private cancelProposalInvolving(sessionId: string) {
    const proposal = this.state.activeProposal;
    if (proposal && (proposal.proposerId === sessionId || proposal.targetId === sessionId)) {
      this.state.activeProposal = undefined;
    }
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
