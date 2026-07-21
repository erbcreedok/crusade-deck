import { useEffect, useState } from "react";
import { Room } from "colyseus.js";
import { MotionConfig } from "framer-motion";
import { Table, TablePlayer } from "./Table";
import { ProposalBanner } from "./ProposalBanner";
import { useMotionPreference } from "./useMotionPreference";

const DECK_SIZE = { "36": 36, "52": 52 } as const;

interface ActiveProposal {
  kind: "dealer" | "kick";
  proposerId: string;
  targetId: string;
  votes: Record<string, boolean>;
}

export function RoomScreen({ room }: { room: Room }) {
  const [players, setPlayers] = useState<TablePlayer[]>([]);
  const [inviteCode, setInviteCode] = useState<string>("");
  const [deckType, setDeckType] = useState<"36" | "52">("36");
  const [isPublic, setIsPublic] = useState(false);
  const [proposal, setProposal] = useState<ActiveProposal | null>(null);
  const { enabled: motionEnabled, toggle: toggleMotion } = useMotionPreference();

  useEffect(() => {
    const sync = () => {
      const list: TablePlayer[] = [];
      room.state.players.forEach((p: any, sessionId: string) => {
        list.push({
          id: sessionId,
          name: p.name,
          isDealer: p.isDealer,
          isReady: p.isReady,
          connected: p.connected,
        });
      });
      setPlayers(list);
      setInviteCode(room.state.inviteCode);
      setDeckType(room.state.deckType);
      setIsPublic(room.state.isPublic);

      // @colyseus/schema всегда отдаёт пустую заглушку для optional nested-schema
      // поля, даже когда оно не установлено на сервере — proposerId остаётся ""
      // до реального старта голосования, это и есть настоящий признак "нет активного".
      const ap = room.state.activeProposal;
      if (!ap || !ap.proposerId) {
        setProposal(null);
      } else {
        const votes: Record<string, boolean> = {};
        ap.votes.forEach((value: boolean, sessionId: string) => {
          votes[sessionId] = value;
        });
        setProposal({ kind: ap.kind, proposerId: ap.proposerId, targetId: ap.targetId, votes });
      }
    };

    room.state.players.onAdd = sync;
    room.state.players.onRemove = sync;
    room.onStateChange(sync);
    sync();
  }, [room]);

  const me = players.find((p) => p.id === room.sessionId);
  const weightOf = (sessionId: string) => {
    const p = players.find((pl) => pl.id === sessionId);
    if (!p || !p.connected) return 0;
    return p.isDealer ? 1.5 : 1;
  };
  const totalWeight = players.reduce((sum, p) => sum + (p.connected ? (p.isDealer ? 1.5 : 1) : 0), 0);
  const yesWeight = proposal
    ? Object.entries(proposal.votes).reduce((s, [id, v]) => (v ? s + weightOf(id) : s), 0)
    : 0;
  const noWeight = proposal
    ? Object.entries(proposal.votes).reduce((s, [id, v]) => (!v ? s + weightOf(id) : s), 0)
    : 0;
  const proposerName = players.find((p) => p.id === proposal?.proposerId)?.name || "?";
  const targetName = players.find((p) => p.id === proposal?.targetId)?.name || "?";
  const myVote = proposal ? proposal.votes[room.sessionId] : undefined;

  return (
    <MotionConfig reducedMotion={motionEnabled ? "never" : "always"}>
      <div className="table-screen">
        <div className="table-topbar">
          {inviteCode && (
            <div className="table-badge">
              код: <span className="pixel-invite-code">{inviteCode}</span>
            </div>
          )}
          {me?.isDealer && (
            <button className="table-motion-toggle" onClick={() => room.send("toggle_public")}>
              {isPublic ? "🌐 Паблик: вкл" : "🔒 Паблик: выкл"}
            </button>
          )}
          <button className="table-motion-toggle" onClick={toggleMotion}>
            {motionEnabled ? "✨ Анимации: вкл" : "◻ Анимации: выкл"}
          </button>
        </div>

        {proposal && (
          <ProposalBanner
            kind={proposal.kind}
            proposerName={proposerName}
            targetName={targetName}
            yesWeight={yesWeight}
            noWeight={noWeight}
            totalWeight={totalWeight}
            myVote={myVote}
            onVote={(value) => room.send("vote", { value })}
          />
        )}

        <Table
          players={players}
          mySessionId={room.sessionId}
          deckCount={DECK_SIZE[deckType]}
          hasActiveProposal={!!proposal}
          onProposeDealer={() => room.send("propose_dealer")}
          onProposeKick={(targetSessionId) => room.send("propose_kick", { targetSessionId })}
        />

        <div className="table-bottombar">
          <button className="pixel-btn" onClick={() => room.send("ready")}>
            Готов
          </button>
          <button className="pixel-btn pixel-btn-secondary" onClick={() => room.send("start_game")}>
            Начать игру
          </button>
        </div>
      </div>
    </MotionConfig>
  );
}
