import { useEffect, useState } from "react";
import type { FaceStyle } from "./game/engine/cardTextures";

// Вид лица числовых карт: "symbol" — один крупный значок по центру (как было),
// "pips" — значков масти столько, сколько номинал. Хранится в localStorage, по
// умолчанию "symbol"; неизвестное значение откатывается к нему же.
const KEY = "crusade-deck:face-style";

function isFaceStyle(v: unknown): v is FaceStyle {
  return v === "symbol" || v === "pips";
}

function initial(): FaceStyle {
  const saved = localStorage.getItem(KEY);
  return isFaceStyle(saved) ? saved : "symbol";
}

export function useFaceStyle() {
  const [faceStyle, setFaceStyle] = useState<FaceStyle>(initial);
  useEffect(() => localStorage.setItem(KEY, faceStyle), [faceStyle]);
  return { faceStyle, setFaceStyle };
}
