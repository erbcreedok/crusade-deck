import { motion } from "framer-motion";

interface SeatProps {
  name: string;
  isDealer: boolean;
  isReady: boolean;
  connected: boolean;
  handCount: number;
  isMe: boolean;
  style: React.CSSProperties;
  menuOpen: boolean;
  hasActiveProposal: boolean;
  onToggleMenu: () => void;
  onProposeDealer: () => void;
  onProposeKick: () => void;
}

function avatarColor(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${hash}, 45%, 36%)`;
}

export function Seat({
  name,
  isDealer,
  isReady,
  connected,
  handCount,
  isMe,
  style,
  menuOpen,
  hasActiveProposal,
  onToggleMenu,
  onProposeDealer,
  onProposeKick,
}: SeatProps) {
  return (
    <motion.div
      className={`seat ${isMe ? "seat-me" : ""} ${!connected ? "seat-disconnected" : ""}`}
      style={style}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
    >
      <div
        className="seat-avatar"
        style={{ background: avatarColor(name) }}
        onClick={(e) => {
          e.stopPropagation();
          onToggleMenu();
        }}
      >
        {name.slice(0, 1).toUpperCase()}
        {isDealer && <span className="seat-crown">♠</span>}
        <span className={`seat-ready-dot ${isReady ? "ready" : ""}`} />
      </div>
      <div className="seat-name">
        {name}
        {isMe ? " (ты)" : ""}
      </div>
      {!connected && <div className="seat-offline">офлайн</div>}
      {!isMe && handCount > 0 && <div className="seat-hand-count">🂠 {handCount}</div>}

      {menuOpen && (
        <div className="seat-menu" onClick={(e) => e.stopPropagation()}>
          {isMe && !isDealer && (
            <button className="seat-menu-item" disabled={hasActiveProposal} onClick={onProposeDealer}>
              Стать дилером
            </button>
          )}
          {!isMe && isDealer && (
            <button className="seat-menu-item" disabled={hasActiveProposal} onClick={onProposeDealer}>
              Попросить дилерство
            </button>
          )}
          {!isMe && (
            <button className="seat-menu-item seat-menu-danger" disabled={hasActiveProposal} onClick={onProposeKick}>
              Предложить кикнуть
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
