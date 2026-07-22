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
const SHADOWS_KEY = "crusade-deck:anim-shadows";
const LEGACY_KEY = "crusade-deck:animations-enabled"; // старый boolean-тумблер

function systemPrefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function initialLevel(): AnimationLevel {
  const saved = localStorage.getItem(LEVEL_KEY);
  if (saved && (ANIMATION_LEVELS as string[]).includes(saved)) return saved as AnimationLevel;
  // Миграция со старого boolean-тумблера: "0" (было «выкл») → умеренная, иначе полная.
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy !== null) return legacy === "0" ? "moderate" : "full";
  // Системное «меньше движения» → умеренная (совсем выключить анимацию нельзя).
  return systemPrefersReducedMotion() ? "moderate" : "full";
}

function initialSpeed(): AnimationSpeed {
  const saved = Number(localStorage.getItem(SPEED_KEY));
  return (ANIMATION_SPEEDS as number[]).includes(saved) ? (saved as AnimationSpeed) : 1;
}

function initialShadows(): boolean {
  // Хранится как "0"/"1"; отсутствует → включены по умолчанию.
  return localStorage.getItem(SHADOWS_KEY) !== "0";
}

// Настройки анимации: уровень + скорость + тени, с сохранением в localStorage и
// миграцией со старого boolean-тумблера.
export function useAnimationSettings() {
  const [level, setLevel] = useState<AnimationLevel>(initialLevel);
  const [speed, setSpeed] = useState<AnimationSpeed>(initialSpeed);
  const [shadows, setShadows] = useState<boolean>(initialShadows);

  useEffect(() => localStorage.setItem(LEVEL_KEY, level), [level]);
  useEffect(() => localStorage.setItem(SPEED_KEY, String(speed)), [speed]);
  useEffect(() => localStorage.setItem(SHADOWS_KEY, shadows ? "1" : "0"), [shadows]);

  const settings: AnimationSettings = { level, speed, shadows };
  return { settings, setLevel, setSpeed, setShadows };
}
