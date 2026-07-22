// Приём «эффектов» колоды от других игроков. Эффекты — украшение: они показывают, ЧТО
// произошло у дилера, но никогда не меняют состояние. Порядок и стороны карт приходят
// схемой Colyseus и всегда главнее — если эффект противоречит данным, играет тишина.

export const FX_MAX_AGE_MS = 1200; // старше — не проигрываем: момент упущен

export interface DeckFxMessage {
  kind: "flip-deck" | "flip-cards" | "spill" | "stretch";
  angle: number;
  cards: string[];
  count: number;
  dur: number; // сколько эффект длился у дилера — повторяем ровно столько же
}

export interface DeckFxIncoming extends DeckFxMessage {
  t: number; // серверное время
}

// Часы для оценки возраста события. Часы клиента и сервера не синхронны, поэтому берём
// классический минимум-фильтр: самая быстрая из виденных доставок считается «нулевой
// задержкой», остальные меряются относительно неё. Нам не нужна точность, нужен ответ на
// вопрос «это только что или уже история».
export class FxClock {
  private offset: number | null = null; // clientNow - serverT при самой быстрой доставке

  age(serverT: number, clientNow: number): number {
    const sample = clientNow - serverT;
    if (this.offset === null || sample < this.offset) this.offset = sample;
    return Math.max(0, sample - this.offset);
  }
}

export function shouldPlayFx(fx: DeckFxIncoming, clientNow: number, clock: FxClock): boolean {
  return clock.age(fx.t, clientNow) <= FX_MAX_AGE_MS;
}
