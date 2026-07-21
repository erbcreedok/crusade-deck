import { useMemo, useState } from "react";
import { Seat } from "./Seat";
import { DeckStack } from "./DeckStack";

export interface TablePlayer {
  id: string;
  name: string;
  isDealer: boolean;
  isReady: boolean;
  connected: boolean;
}

// Виртуальный круглый стол: места распределены по эллипсу, свое место —
// всегда внизу по центру ("зеркало" — ты всегда видишь себя на одном и том
// же месте, остальные — вокруг тебя).
export function Table({
  players,
  mySessionId,
  deckCount,
  hasActiveProposal,
  onProposeDealer,
  onProposeKick,
}: {
  players: TablePlayer[];
  mySessionId: string;
  deckCount: number;
  hasActiveProposal: boolean;
  onProposeDealer: () => void;
  onProposeKick: (targetSessionId: string) => void;
}) {
  const [openSeatId, setOpenSeatId] = useState<string | null>(null);

  const ordered = useMemo(() => {
    const idx = players.findIndex((p) => p.id === mySessionId);
    if (idx <= 0) return players;
    return [...players.slice(idx), ...players.slice(0, idx)];
  }, [players, mySessionId]);

  const total = Math.max(ordered.length, 1);
  const rx = 36;
  const ry = 36;

  return (
    <div className="table-oval" onClick={() => setOpenSeatId(null)}>
      <div className="table-center">
        <DeckStack count={deckCount} />
      </div>
      {ordered.map((p, i) => {
        const angle = ((180 + (i * 360) / total) * Math.PI) / 180;
        const left = 50 + rx * Math.sin(angle);
        const top = 50 - ry * Math.cos(angle);
        return (
          <Seat
            key={p.id}
            name={p.name}
            isDealer={p.isDealer}
            isReady={p.isReady}
            connected={p.connected}
            isMe={p.id === mySessionId}
            style={{ left: `${left}%`, top: `${top}%` }}
            menuOpen={openSeatId === p.id}
            hasActiveProposal={hasActiveProposal}
            onToggleMenu={() => setOpenSeatId(openSeatId === p.id ? null : p.id)}
            onProposeDealer={() => {
              onProposeDealer();
              setOpenSeatId(null);
            }}
            onProposeKick={() => {
              onProposeKick(p.id);
              setOpenSeatId(null);
            }}
          />
        );
      })}
    </div>
  );
}
