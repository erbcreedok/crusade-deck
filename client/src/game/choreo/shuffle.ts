import { anim } from "../anim/config";
import type { CardTargets } from "../CardBody";

export interface ShuffleParams {
  count: number;
  anchor: { x: number; y: number };
  seed?: number;
}

// Хореография риффл-шаффла: по времени t выдаёт ЦЕЛИ карт. Сама физику не считает —
// цели скармливаются пружинам CardBody, за счёт чего полёт непрерывный и с инерцией.
//
// Ключевая идея: у КАЖДОЙ карты свой сдвиг старта (delay). Колода делится на две
// половины (верх/низ), а порядок старта идёт по ЧЕРЕСПОЛОСИЦЕ — L,R,L,R,… — как при
// реальном riffle-bridge. Разные старты дают каскад/веер (карты взлетают и
// складываются волной), а per-card разброс spread/arch/lean — что дистанция и угол
// у соседних карт «немного отличаются», а не строем.
//
// Детерминирована по seed (разброс углов и множители), чтобы поведение было
// воспроизводимым/тестируемым.
export class ShuffleChoreography {
  readonly durationSec: number;

  private readonly count: number;
  private readonly anchor: { x: number; y: number };
  private readonly baseDur: number; // длительность фаз для ОДНОЙ карты (без разброса старта)
  private readonly t1: number; // конец подъёма (в локальном времени карты)
  private readonly t2: number; // конец риффла (в локальном времени карты)

  private readonly delay: number[]; // сдвиг старта каждой карты (каскад/чересполосица)
  private readonly side: number[]; // -1 (левая половина) / +1 (правая)
  private readonly restRot: number[]; // финальный угол в покое (лёгкий разброс)
  private readonly spreadF: number[]; // множитель дистанции разлёта на карту
  private readonly archF: number[]; // множитель высоты дуги на карту
  private readonly leanF: number[]; // множитель крена на карту

  constructor(p: ShuffleParams) {
    this.count = Math.max(0, Math.floor(p.count));
    this.anchor = p.anchor;

    const { lift, riffle, settle, stagger } = anim.shuffle;
    this.t1 = lift.dur;
    this.t2 = lift.dur + riffle.dur;
    this.baseDur = lift.dur + riffle.dur + settle.dur;
    // Последняя по чересполосице карта стартует на stagger.total позже → на столько же
    // длиннее вся анимация. Для одной карты разброса нет.
    this.durationSec = this.baseDur + (this.count > 1 ? stagger.total : 0);

    const rand = mulberry32((p.seed ?? 1) >>> 0);
    const half = Math.ceil(this.count / 2); // размер левой (верхней) половины
    const denom = Math.max(1, this.count - 1);

    this.delay = [];
    this.side = [];
    this.restRot = [];
    this.spreadF = [];
    this.archF = [];
    this.leanF = [];
    for (let i = 0; i < this.count; i++) {
      // Ранг в чересполосице: левые карты k → 2k, правые j → 2j+1 (L,R,L,R,…).
      const isLeft = i < half;
      const rank = isLeft ? 2 * i : 2 * (i - half) + 1;
      this.side.push(isLeft ? -1 : 1);
      this.delay.push(this.count > 1 ? (rank / denom) * stagger.total : 0);

      // Порядок вызовов rand() фиксирован — от него зависит детерминизм по seed.
      this.restRot.push((rand() * 2 - 1) * settle.jitter);
      this.spreadF.push(1 + (rand() * 2 - 1) * stagger.spreadVar);
      this.archF.push(1 + (rand() * 2 - 1) * stagger.archVar);
      this.leanF.push(1 + (rand() * 2 - 1) * stagger.leanVar);
    }
  }

  // Индексы карт в порядке старта (по чересполосице). Полезно и движку для z-порядка,
  // чтобы половины визуально прошивали друг друга, а не одна пачка поверх другой.
  startOrder(): number[] {
    return Array.from({ length: this.count }, (_, i) => i).sort(
      (a, b) => this.delay[a] - this.delay[b],
    );
  }

  // Покой: ровная стопка у якоря, с толщиной по Y и лёгким разбросом углов.
  private restTarget(i: number): CardTargets {
    return {
      x: this.anchor.x,
      y: this.anchor.y - i * anim.deck.stackDy,
      rot: this.restRot[i],
      scale: 1,
    };
  }

  // Цели всех карт в момент tSec.
  sample(tSec: number): CardTargets[] {
    const { lift, riffle } = anim.shuffle;
    const out: CardTargets[] = [];
    for (let i = 0; i < this.count; i++) {
      // Локальное время карты: со сдвигом старта и клампом в её собственные фазы.
      const tau = clamp(tSec - this.delay[i], 0, this.baseDur);
      const lf = this.liftFactor(tau); // 0 в покое, 1 на пике (риффл)
      const bump = this.riffleBump(tau); // 0→1→0 в окне риффла
      const rest = this.restTarget(i);
      out.push({
        x: rest.x! + this.side[i] * riffle.spread * this.spreadF[i] * bump,
        y: rest.y! - lift.height * lf - riffle.arch * this.archF[i] * bump,
        rot: rest.rot! + this.side[i] * riffle.lean * this.leanF[i] * bump,
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
