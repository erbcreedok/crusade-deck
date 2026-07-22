export type BackgroundVariant = "menu" | "game";

/**
 * Фон приложения. Два варианта, чтобы комната визуально отличалась от меню:
 * "menu" — тёплое зелёное сукно (как было), "game" — серо-зелёный, более контрастный.
 */
export function PixelBackground({
  enabled,
  variant = "menu",
}: {
  enabled: boolean;
  variant?: BackgroundVariant;
}) {
  const pausedClass = enabled ? "" : " motion-paused";
  const variantClass = variant === "game" ? " pixel-bg--game" : "";
  return (
    <>
      <div
        className={`pixel-bg-layer pixel-bg-clubs${variantClass}${pausedClass}`}
        aria-hidden="true"
      />
      <div
        className={`pixel-bg-layer pixel-bg-diamonds${variantClass}${pausedClass}`}
        aria-hidden="true"
      />
    </>
  );
}
