import type { BackgroundVariant } from "./PixelBackground";

// Цвет строки состояния на мобильных. Держим в паре с фоном (см. PixelBackground и
// .pixel-bg--game в theme.css): в комнате сукно серо-зелёное — значит и полоса такая же,
// иначе на iOS сверху остаётся чужая зелёная кромка.
export const THEME_COLORS: Record<BackgroundVariant, string> = {
  menu: "#173d2d", // --felt
  game: "#333f3a", // сукно комнаты (bg-clubs-slate.svg)
};

export function applyThemeColor(variant: BackgroundVariant, doc: Document = document): void {
  let meta = doc.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = doc.createElement("meta");
    meta.setAttribute("name", "theme-color");
    doc.head.appendChild(meta);
  }
  meta.setAttribute("content", THEME_COLORS[variant]);
}
