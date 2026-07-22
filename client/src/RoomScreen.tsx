import { useCallback, useEffect, useRef, useState } from "react";
import { Room } from "colyseus.js";
import { ProposalBanner } from "./ProposalBanner";
import { RoomCanvas, type RoomCanvasHandle } from "./game/RoomCanvas";
import { deckZoneFor, type DeckZone } from "./game/deckZone";
import type { AnimationSettings } from "./game/anim/animationSettings";

interface RoomPlayer {
  id: string;
  name: string;
  isDealer: boolean;
  connected: boolean;
}

interface ActiveProposal {
  kind: "dealer" | "kick";
  proposerId: string;
  targetId: string;
  deadline: number;
  votes: Record<string, boolean>;
}

// Экран комнаты без отрисованной сцены (стол/места/рука/колода сняты).
// Осталась рабочая обвязка: топбар, баннер голосования, кнопки лобби.
export function RoomScreen({ room, animation }: { room: Room; animation: AnimationSettings }) {
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [inviteCode, setInviteCode] = useState<string>("");
  const [isPublic, setIsPublic] = useState(false);
  const [phase, setPhase] = useState<"lobby" | "playing" | "finished">("lobby");
  const [proposal, setProposal] = useState<ActiveProposal | null>(null);
  const [deckCount, setDeckCount] = useState(0);
  const [deckZone, setDeckZone] = useState<DeckZone>("center");
  const canvasRef = useRef<RoomCanvasHandle>(null);

  useEffect(() => {
    const sync = () => {
      const list: RoomPlayer[] = [];
      room.state.players.forEach((p: any, sessionId: string) => {
        list.push({
          id: sessionId,
          name: p.name,
          isDealer: p.isDealer,
          connected: p.connected,
        });
      });
      setPlayers(list);
      setInviteCode(room.state.inviteCode);
      setIsPublic(room.state.isPublic);
      setPhase(room.state.phase);
      setDeckCount(room.state.deck?.length ?? 0);
      setDeckZone(deckZoneFor(room.state.deckLocation ?? "center", room.sessionId));

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
        setProposal({ kind: ap.kind, proposerId: ap.proposerId, targetId: ap.targetId, deadline: ap.deadline, votes });
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

  // Колоду двигает только дилер и только в лобби (во время раздачи).
  const canMoveDeck = amIDealer && phase === "lobby";

  // Дабл-клик по колоде: быстрый тоггл центр ⇄ своя сейф-зона.
  const onDeckDoubleClick = useCallback(() => {
    if (!canMoveDeck) return;
    room.send("move_deck", { zone: deckZone === "safe" ? "center" : "safe" });
  }, [canMoveDeck, deckZone, room]);

  // Драг-н-дроп: колода брошена в дроп-зону — шлём её на сервер (там валидируется).
  const onDeckDrop = useCallback(
    (zone: "center" | "safe") => {
      if (!canMoveDeck) return;
      room.send("move_deck", { zone });
    },
    [canMoveDeck, room],
  );

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
          deadline={proposal.deadline}
          myVote={myVote}
          onVote={(value) => room.send("vote", { value })}
        />
      )}

      <RoomCanvas
        ref={canvasRef}
        deckCount={deckCount}
        deckZone={deckZone}
        deckDraggable={canMoveDeck}
        onDeckDoubleClick={onDeckDoubleClick}
        onDeckDrop={onDeckDrop}
        animation={animation}
      />

      <div className="table-bottombar">
        {phase === "lobby" && (
          <>
            <button className="pixel-btn" onClick={() => room.send("ready")}>
              Готов
            </button>
            {amIDealer && (
              <button
                className="pixel-btn pixel-btn-secondary"
                onClick={() => {
                  room.send("shuffle_deck"); // сервер тасует по-настоящему
                  canvasRef.current?.shuffle(); // движок показывает анимацию растасовки
                }}
              >
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
