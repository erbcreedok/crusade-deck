import { anim } from "../anim/config";
import type { CardTargets } from "../CardBody";
import type { Choreography } from "./types";

export interface SpinParams {
  count: number;
  anchor: { x: number; y: number };
  seed?: number;
}

const TWO_PI = Math.PI * 2;

// Умеренная растасовка: колода единым блоком делает короткий оборот по часовой и оседает.
// Никакого разлёта/чересполосицы — минимум движущихся элементов. Ease-out навешивает
// движок при воспроизведении, поэтому здесь время линейно.
export class SpinChoreography implements Choreography {
  readonly durationSec: number;

  private readonly count: number;
  private readonly anchor: { x: number; y: number };
  private readonly restRot: number[]; // лёгкий разброс углов в покое (как у стопки)

  constructor(p: SpinParams) {
    this.count = Math.max(0, Math.floor(p.count));
    this.anchor = p.anchor;
    this.durationSec = anim.shuffle.spin.dur;

    const rand = mulberry32((p.seed ?? 1) >>> 0);
    this.restRot = [];
    for (let i = 0; i < this.count; i++) {
      this.restRot.push((rand() * 2 - 1) * anim.shuffle.settle.jitter);
    }
  }

  // Без чересполосицы — карты стартуют вместе, z-порядок натуральный.
  startOrder(): number[] {
    return Array.from({ length: this.count }, (_, i) => i);
  }

  sample(tSec: number): CardTargets[] {
    const { spin, deck } = { spin: anim.shuffle.spin, deck: anim.deck };
    const p = this.durationSec > 0 ? clamp(tSec / this.durationSec, 0, 1) : 1;
    const lift = spin.lift * Math.sin(Math.PI * p); // лёгкий подъём вверх-вниз за оборот
    const turn = TWO_PI * spin.turns * p; // по часовой (в экранных координатах +rot = по часовой)

    const out: CardTargets[] = [];
    for (let i = 0; i < this.count; i++) {
      out.push({
        x: this.anchor.x,
        y: this.anchor.y - i * deck.stackDy - lift,
        rot: this.restRot[i] + turn,
        scale: 1,
      });
    }
    return out;
  }

  done(tSec: number): boolean {
    return tSec >= this.durationSec;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
