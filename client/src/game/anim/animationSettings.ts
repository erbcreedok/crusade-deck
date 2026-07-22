import { anim } from "./config";

// Пользовательские настройки анимации: уровень + скорость. Хранятся/выбираются в UI.
// Только «полная» и «умеренная» — совсем выключить анимацию нельзя (растасовка всегда есть).
export type AnimationLevel = "full" | "moderate";
export type AnimationSpeed = 1 | 2 | 3;

export interface AnimationSettings {
  level: AnimationLevel;
  speed: AnimationSpeed;
}

export const ANIMATION_LEVELS: AnimationLevel[] = ["full", "moderate"];
export const ANIMATION_SPEEDS: AnimationSpeed[] = [1, 2, 3];

export const DEFAULT_ANIMATION_SETTINGS: AnimationSettings = { level: "full", speed: 1 };

// «Профиль» — то, что реально читает движок. Чистая производная от настроек:
//  - speed:          множитель времени анимаций (1/2/3)
//  - fpsCap:         умеренный режим режет фреймрейт (0 = без ограничения)
//  - tilt:           инерционный крен карты (juice) — гасится в умеренном
//  - scaleBump:      масштабный «пульс» на подъёме (juice) — гасится в умеренном
//  - jitter:         множитель per-card разброса углов/дистанций (0..1)
//  - stagger:        множитель веерного каскада — задержки старта карт (0..1)
//  - minPriority:    анимации с приоритетом НИЖЕ этого не проигрываются (адаптивность)
//  - shuffleVariant: полная — риффл-бридж, умеренная — короткий оборот по часовой
export interface AnimationProfile {
  speed: number;
  fpsCap: number;
  tilt: boolean;
  scaleBump: boolean;
  jitter: number;
  stagger: number;
  minPriority: number;
  shuffleVariant: "riffle" | "spin";
}

// Умеренный уровень не даёт выбора скорости — оборот колоды всегда идёт в этом темпе.
const MODERATE_SPEED = 2;

// Уровень + скорость → профиль движка. Единственное место, где «умеренный» описан явно.
export function resolveProfile(s: AnimationSettings): AnimationProfile {
  if (s.level === "moderate") {
    // Сброшенный фреймрейт, без «сока», короткая растасовка-оборот в фиксированном темпе
    // (настройка скорости на умеренном не показывается). Idle-анимации отсекаются
    // приоритетом (ниже shuffle), а сама растасовка всегда остаётся.
    return { speed: MODERATE_SPEED, fpsCap: 30, tilt: false, scaleBump: false, jitter: 0.35, stagger: 0.4, minPriority: anim.priority.shuffle, shuffleVariant: "spin" };
  }
  // full — всё включено, полный фил и риффл-бридж.
  return { speed: s.speed, fpsCap: 60, tilt: true, scaleBump: true, jitter: 1, stagger: 1, minPriority: anim.priority.idle, shuffleVariant: "riffle" };
}

// Проходит ли анимация данного приоритета при этом профиле (порог приоритета).
export function shouldPlay(priority: number, p: AnimationProfile): boolean {
  return priority >= p.minPriority;
}
