import { cardBackSkin, type CardBackId } from "./game/cardBack";

// Мелкий значок текущей рубашки в строке «Рубашка ›» — тот же запечённый образ, что и
// на столе (cardBackBaker). Сам грид выбора — живой канвас (CardBackCanvas).
export function CardBackChip({ id, url }: { id: CardBackId; url?: string }) {
  if (!url) {
    const bg = `#${cardBackSkin(id).bg.toString(16).padStart(6, "0")}`;
    return <span className="back-chip back-ph" style={{ background: bg }} aria-hidden />;
  }
  return <img className="back-chip" src={url} alt="" aria-hidden />;
}
