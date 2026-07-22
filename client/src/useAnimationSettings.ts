import { useEffect, useState } from "react";
import {
  ANIMATION_LEVELS,
  ANIMATION_SPEEDS,
  type AnimationLevel,
  type AnimationSettings,
  type AnimationSpeed,
} from "./game/anim/animationSettings";

const LEVEL_KEY = "crusade-deck:anim-level";
const SPEED_KEY = "crusade-deck:anim-speed";
const LEGACY_KEY = "crusade-deck:animations-enabled"; // старый boolean-тумблер

function systemPrefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function initialLevel(): AnimationLevel {
  const saved = localStorage.getItem(LEVEL_KEY);
  if (saved && (ANIMATION_LEVELS as string[]).includes(saved)) return saved as AnimationLevel;
  // Миграция со старого boolean-тумблера: "0" → выкл, иначе полная.
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy !== null) return legacy === "0" ? "off" : "full";
  return systemPrefersReducedMotion() ? "off" : "full";
}

function initialSpeed(): AnimationSpeed {
  const saved = Number(localStorage.getItem(SPEED_KEY));
  return (ANIMATION_SPEEDS as number[]).includes(saved) ? (saved as AnimationSpeed) : 1;
}

// Настройки анимации: уровень + скорость, с сохранением в localStorage и миграцией
// со старого boolean-тумблера. motionEnabled — производное для не-canvas UI
// (Framer Motion, CSS-фон), которым достаточно знать «есть движение или нет».
export function useAnimationSettings() {
  const [level, setLevel] = useState<AnimationLevel>(initialLevel);
  const [speed, setSpeed] = useState<AnimationSpeed>(initialSpeed);

  useEffect(() => localStorage.setItem(LEVEL_KEY, level), [level]);
  useEffect(() => localStorage.setItem(SPEED_KEY, String(speed)), [speed]);

  const settings: AnimationSettings = { level, speed };
  return { settings, setLevel, setSpeed, motionEnabled: level !== "off" };
}
