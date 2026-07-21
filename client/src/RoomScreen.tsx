import { useEffect, useRef, useState } from "react";
import { Room } from "colyseus.js";
import { Table, TablePlayer } from "./Table";
import { ProposalBanner } from "./ProposalBanner";
import { Hand } from "./Hand";

interface ActiveProposal {
  kind: "dealer" | "kick";
  proposerId: string;
  targetId: string;
  votes: Record<string, boolean>;
}

export function RoomScreen({ room }: { room: Room }) {
  const [players, setPlayers] = useState<TablePlayer[]>([]);
  const [inviteCode, setInviteCode] = useState<string>("");
  const [isPublic, setIsPublic] = useState(false);
  const [phase, setPhase] = useState<"lobby" | "playing" | "finished">("lobby");
  const [deckCount, setDeckCount] = useState(0);
  const [shuffleTick, setShuffleTick] = useState(0);
  const [myHand, setMyHand] = useState<string[]>([]);
  const [proposal, setProposal] = useState<ActiveProposal | null>(null);
  const prevDeckSig = useRef("");
  const prevDeckLength = useRef(-1);

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
          handCount: p.hand.length,
        });
      });
      setPlayers(list);
      setInviteCode(room.state.inviteCode);
      setIsPublic(room.state.isPublic);
      setPhase(room.state.phase);

      const deckArr: string[] = [...room.state.deck];
      setDeckCount(deckArr.length);
      const deckSig = deckArr.join(",");
      if (deckSig !== prevDeckSig.current) {
        if (deckArr.length === prevDeckLength.current) {
          // длина колоды не поменялась, но порядок другой — значит, тасовка
          setShuffleTick((t) => t + 1);
        }
        prevDeckSig.current = deckSig;
        prevDeckLength.current = deckArr.length;
      }

      const me = room.state.players.get(room.sessionId);
      setMyHand(me ? [...me.hand] : []);

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
  const amIDealer = players.find((p) => p.id === room.sessionId)?.isDealer ?? false;

  return (
    <div className="table-screen">
      <div className="table-topbar">
        {inviteCode && (
          <div className="table-badge">
            код: <span className="pixel-invite-code">{inviteCode}</span>
          </div>
        )}
        <div className="table-badge">{isPublic ? "🌐 паблик" : "🔒 приват"}</div>
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
        deckCount={deckCount}
        shuffleTick={shuffleTick}
        hasActiveProposal={!!proposal}
        onProposeDealer={() => room.send("propose_dealer")}
        onProposeKick={(targetSessionId) => room.send("propose_kick", { targetSessionId })}
      />

      {phase === "playing" && myHand.length > 0 && <Hand cards={myHand} />}

      <div className="table-bottombar">
        {phase === "lobby" && (
          <>
            <button className="pixel-btn" onClick={() => room.send("ready")}>
              Готов
            </button>
            {amIDealer && (
              <button className="pixel-btn pixel-btn-secondary" onClick={() => room.send("shuffle_deck")}>
                Растасовать
              </button>
            )}
            {amIDealer && (
              <button className="pixel-btn pixel-btn-secondary" onClick={() => room.send("start_game")}>
                Раздать
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
