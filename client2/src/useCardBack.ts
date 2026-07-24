import { useEffect, useState } from "react";
import { DEFAULT_CARD_BACK, isCardBackId, type CardBackId } from "./game/cardBack";

// Выбранный скин рубашки карт. Хранится в localStorage по id скина; неизвестное
// значение (старая версия/ручная правка) откатывается к скину по умолчанию.
const KEY = "crusade-deck:card-back";

function initial(): CardBackId {
  const saved = localStorage.getItem(KEY);
  return isCardBackId(saved) ? saved : DEFAULT_CARD_BACK;
}

export function useCardBack() {
  const [cardBack, setCardBack] = useState<CardBackId>(initial);
  useEffect(() => localStorage.setItem(KEY, cardBack), [cardBack]);
  return { cardBack, setCardBack };
}
