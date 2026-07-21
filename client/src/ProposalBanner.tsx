interface Props {
  kind: "dealer" | "kick";
  proposerName: string;
  targetName: string;
  yesWeight: number;
  noWeight: number;
  totalWeight: number;
  myVote: boolean | undefined;
  onVote: (value: boolean) => void;
}

export function ProposalBanner({
  kind,
  proposerName,
  targetName,
  yesWeight,
  noWeight,
  totalWeight,
  myVote,
  onVote,
}: Props) {
  const pct = totalWeight > 0 ? Math.round((yesWeight / totalWeight) * 100) : 0;
  const text =
    kind === "kick" ? `Кикнуть игрока ${targetName}?` : `${proposerName} хочет стать дилером`;

  return (
    <div className="proposal-banner">
      <p className="proposal-text">{text}</p>
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
