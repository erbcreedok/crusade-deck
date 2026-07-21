import { useEffect, useState } from "react";

const KEY = "crusade-deck:animations-enabled";

function systemPrefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function useMotionPreference() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem(KEY);
    if (saved !== null) return saved === "1";
    return !systemPrefersReducedMotion();
  });

  useEffect(() => {
    localStorage.setItem(KEY, enabled ? "1" : "0");
  }, [enabled]);

  return { enabled, toggle: () => setEnabled((v) => !v) };
}
