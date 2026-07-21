import { useEffect, useState } from "react";

interface Props {
  kind: "dealer" | "kick";
  proposerName: string;
  targetName: string;
  yesWeight: number;
  noWeight: number;
  totalWeight: number;
  deadline: number;
  myVote: boolean | undefined;
  onVote: (value: boolean) => void;
}

function useCountdown(deadline: number) {
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));

  useEffect(() => {
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);

  return secondsLeft;
}

export function ProposalBanner({
  kind,
  proposerName,
  targetName,
  yesWeight,
  noWeight,
  totalWeight,
  deadline,
  myVote,
  onVote,
}: Props) {
  const pct = totalWeight > 0 ? Math.round((yesWeight / totalWeight) * 100) : 0;
  const secondsLeft = useCountdown(deadline);
  const text =
    kind === "kick" ? `Кикнуть игрока ${targetName}?` : `${proposerName} хочет стать дилером`;

  return (
    <div className="proposal-banner">
      <p className="proposal-text">
        {text} <span className="proposal-countdown">{secondsLeft}с</span>
      </p>
      <p className="proposal-tally">
        За: {yesWeight} ({pct}%) · Против: {noWeight}
      </p>
      <div className="pixel-btn-row">
        <button
          className={`pixel-btn ${myVote === true ? "pixel-btn-voted" : ""}`}
          onClick={() => onVote(true)}
        >
          За
        </button>
        <button
          className={`pixel-btn pixel-btn-secondary ${myVote === false ? "pixel-btn-voted" : ""}`}
          onClick={() => onVote(false)}
        >
          Против
        </button>
      </div>
    </div>
  );
}
