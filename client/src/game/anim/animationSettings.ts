import { anim } from "./config";

// Пользовательские настройки анимации: уровень + скорость. Хранятся/выбираются в UI.
export type AnimationLevel = "full" | "moderate" | "off";
export type AnimationSpeed = 1 | 2 | 4;

export interface AnimationSettings {
  level: AnimationLevel;
  speed: AnimationSpeed;
}

export const ANIMATION_LEVELS: AnimationLevel[] = ["full", "moderate", "off"];
export const ANIMATION_SPEEDS: AnimationSpeed[] = [1, 2, 4];

export const DEFAULT_ANIMATION_SETTINGS: AnimationSettings = { level: "full", speed: 1 };

// «Профиль» — то, что реально читает движок. Чистая производная от настроек:
//  - motion:      false → мгновенный snap без анимаций
//  - speed:       множитель времени анимаций (1/2/4)
//  - fpsCap:      умеренный режим режет фреймрейт (0 = без ограничения)
//  - tilt:        инерционный крен карты (juice) — гасится в умеренном
//  - scaleBump:   масштабный «пульс» на подъёме (juice) — гасится в умеренном
//  - jitter:      множитель per-card разброса углов/дистанций (0..1)
//  - stagger:     множитель веерного каскада — задержки старта карт (0..1)
//  - minPriority: анимации с приоритетом НИЖЕ этого просто не проигрываются (адаптивность)
export interface AnimationProfile {
  motion: boolean;
  speed: number;
  fpsCap: number;
  tilt: boolean;
  scaleBump: boolean;
  jitter: number;
  stagger: number;
  minPriority: number;
}

// Уровень + скорость → профиль движка. Единственное место, где «умеренный» описан явно.
export function resolveProfile(s: AnimationSettings): AnimationProfile {
  switch (s.level) {
    case "off":
      // Никакой анимации: телепорт. minPriority = ∞ → не проходит ни одна.
      return { motion: false, speed: s.speed, fpsCap: 0, tilt: false, scaleBump: false, jitter: 0, stagger: 0, minPriority: Infinity };
    case "moderate":
      // Сброшенный фреймрейт + без «сока», ужатый каскад/разброс. Idle-анимации отсекаются
      // приоритетом (ниже shuffle), а важные (растасовка/раздача) остаются, но проще.
      return { motion: true, speed: s.speed, fpsCap: 30, tilt: false, scaleBump: false, jitter: 0.35, stagger: 0.4, minPriority: anim.priority.shuffle };
    case "full":
    default:
      // Всё включено, полный фил.
      return { motion: true, speed: s.speed, fpsCap: 60, tilt: true, scaleBump: true, jitter: 1, stagger: 1, minPriority: anim.priority.idle };
  }
}

// Проходит ли анимация данного приоритета при этом профиле (motion + порог приоритета).
export function shouldPlay(priority: number, p: AnimationProfile): boolean {
  return p.motion && priority >= p.minPriority;
}
