import { anim } from "../anim/config";
import type { CardTargets } from "../CardBody";

export interface ShuffleParams {
  count: number;
  anchor: { x: number; y: number };
  seed?: number;
}

// Хореография риффл-шаффла: по времени t выдаёт ЦЕЛИ карт. Сама физику не считает —
// цели скармливаются пружинам CardBody, за счёт чего полёт непрерывный и с инерцией.
// Детерминирована по seed (разброс углов), чтобы поведение было воспроизводимым/тестируемым.
export class ShuffleChoreography {
  readonly durationSec: number;

  private readonly count: number;
  private readonly anchor: { x: number; y: number };
  private readonly t1: number; // конец подъёма
  private readonly t2: number; // конец риффла
  private readonly jitter: number[]; // финальный угол на карту
  private readonly side: number[]; // -1 (левая половина) / +1 (правая)

  constructor(p: ShuffleParams) {
    this.count = Math.max(0, Math.floor(p.count));
    this.anchor = p.anchor;

    const { lift, riffle, settle } = anim.shuffle;
    this.t1 = lift.dur;
    this.t2 = lift.dur + riffle.dur;
    this.durationSec = lift.dur + riffle.dur + settle.dur;

    const rand = mulberry32((p.seed ?? 1) >>> 0);
    this.jitter = [];
    this.side = [];
    const half = this.count / 2;
    for (let i = 0; i < this.count; i++) {
      this.jitter.push((rand() * 2 - 1) * settle.jitter);
      this.side.push(i < half ? -1 : 1);
    }
  }

  // Покой: ровная стопка у якоря, с толщиной по Y и лёгким разбросом углов.
  private restTarget(i: number): CardTargets {
    return {
      x: this.anchor.x,
      y: this.anchor.y - i * anim.deck.stackDy,
      rot: this.jitter[i],
      scale: 1,
    };
  }

  // Цели всех карт в момент tSec.
  sample(tSec: number): CardTargets[] {
    const t = clamp(tSec, 0, this.durationSec);
    const lf = this.liftFactor(t); // 0 в покое, 1 на пике (риффл)
    const bump = this.riffleBump(t); // 0→1→0 в окне риффла

    const { lift, riffle } = anim.shuffle;
    const out: CardTargets[] = [];
    for (let i = 0; i < this.count; i++) {
      const rest = this.restTarget(i);
      out.push({
        x: rest.x! + this.side[i] * riffle.spread * bump,
        y: rest.y! - lift.height * lf - riffle.arch * bump,
        rot: rest.rot! + this.side[i] * riffle.lean * bump,
        scale: 1 + 0.04 * lf,
      });
    }
    return out;
  }

  done(tSec: number): boolean {
    return tSec >= this.durationSec;
  }

  // Подъём стопки: 0 → 1 за фазу lift, держится 1 весь риффл, 1 → 0 за фазу settle.
  private liftFactor(t: number): number {
    if (t <= this.t1) return smoothstep(this.t1 <= 0 ? 1 : t / this.t1);
    if (t <= this.t2) return 1;
    const s = anim.shuffle.settle.dur;
    return 1 - smoothstep(s <= 0 ? 1 : (t - this.t2) / s);
  }

  // Разлёт половин: 0 → 1 → 0 внутри окна риффла (синус-горб), иначе 0.
  private riffleBump(t: number): number {
    if (t <= this.t1 || t >= this.t2) return 0;
    const r = anim.shuffle.riffle.dur;
    return Math.sin(Math.PI * ((t - this.t1) / r));
  }
}

function smoothstep(x: number): number {
  const c = clamp(x, 0, 1);
  return c * c * (3 - 2 * c);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Детерминированный PRNG (mulberry32) — один и тот же seed даёт один и тот же разброс.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
