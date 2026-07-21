function parseCard(card: string) {
  const suit = card.slice(-1);
  const rank = card.slice(0, -1);
  const isRed = suit === "♥" || suit === "♦";
  return { rank, suit, isRed };
}

export function Card({ card }: { card: string }) {
  const { rank, suit, isRed } = parseCard(card);
  return (
    <div className={`playing-card ${isRed ? "playing-card-red" : "playing-card-black"}`}>
      <div className="playing-card-corner">
        {rank}
        <br />
        {suit}
      </div>
      <div className="playing-card-suit-big">{suit}</div>
    </div>
  );
}
