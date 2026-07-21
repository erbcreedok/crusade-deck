export function PixelBackground({ enabled }: { enabled: boolean }) {
  const pausedClass = enabled ? "" : " motion-paused";
  return (
    <>
      <div className={`pixel-bg-layer pixel-bg-clubs${pausedClass}`} aria-hidden="true" />
      <div className={`pixel-bg-layer pixel-bg-diamonds${pausedClass}`} aria-hidden="true" />
    </>
  );
}
