import { useEffect, useState } from "react";

// Четырёхцветная колода (♦ оранжевый, ♣ голубой) — режим для слабовидящих. Хранится
// в localStorage как "0"/"1", по умолчанию выключен.
const KEY = "crusade-deck:four-color";

function initial(): boolean {
  return localStorage.getItem(KEY) === "1";
}

export function useFourColor() {
  const [fourColor, setFourColor] = useState<boolean>(initial);
  useEffect(() => localStorage.setItem(KEY, fourColor ? "1" : "0"), [fourColor]);
  return { fourColor, setFourColor };
}
