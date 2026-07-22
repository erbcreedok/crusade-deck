import { anim } from "./anim/config";
import { stepSpring, isSettled, type SpringState } from "./physics/spring";

export interface CardTargets {
  x?: number;
  y?: number;
  rot?: number;
  scale?: number;
}

// Одна карта как физический объект движка (НЕ React-нода, НЕ Pixi-нода).
// Держит по пружине на каждый визуальный канал; спрайт лишь читает px/py/rotation/scaleVal.
// Именно это делает полёт «непрерывным с физикой», а не переходом из ноды в ноду.
export class CardBody {
  private cx: SpringState;
  private cy: SpringState;
  private crot: SpringState;
  private cscale: SpringState;

  private tx: number;
  private ty: number;
  private trot: number;
  private tscale: number;

  constructor(x = 0, y = 0, rot = 0, scale = 1) {
    this.cx = { pos: x, vel: 0 };
    this.cy = { pos: y, vel: 0 };
    this.crot = { pos: rot, vel: 0 };
    this.cscale = { pos: scale, vel: 0 };
    this.tx = x;
    this.ty = y;
    this.trot = rot;
    this.tscale = scale;
  }

  // Задать цель (частично) — карта плавно полетит туда через пружины.
  setTarget(t: CardTargets): void {
    if (t.x !== undefined) this.tx = t.x;
    if (t.y !== undefined) this.ty = t.y;
    if (t.rot !== undefined) this.trot = t.rot;
    if (t.scale !== undefined) this.tscale = t.scale;
  }

  // Телепорт: и текущее, и целевое сразу (расстановка при инициализации/ресайзе).
  snapTo(t: CardTargets): void {
    if (t.x !== undefined) { this.cx = { pos: t.x, vel: 0 }; this.tx = t.x; }
    if (t.y !== undefined) { this.cy = { pos: t.y, vel: 0 }; this.ty = t.y; }
    if (t.rot !== undefined) { this.crot = { pos: t.rot, vel: 0 }; this.trot = t.rot; }
    if (t.scale !== undefined) { this.cscale = { pos: t.scale, vel: 0 }; this.tscale = t.scale; }
  }

  // Шаг физики. snap=true (анимации выключены) → мгновенно в цели.
  step(dt: number, snap = false): void {
    this.cx = stepSpring(this.cx, this.tx, anim.posSpring, dt, snap);
    this.cy = stepSpring(this.cy, this.ty, anim.posSpring, dt, snap);
    this.crot = stepSpring(this.crot, this.trot, anim.rotSpring, dt, snap);
    this.cscale = stepSpring(this.cscale, this.tscale, anim.scaleSpring, dt, snap);
  }

  // Все каналы осели у своих целей — карта «в покое». Движок по этому усыпляет рендер-цикл.
  isResting(): boolean {
    return (
      isSettled(this.cx, this.tx) &&
      isSettled(this.cy, this.ty) &&
      isSettled(this.crot, this.trot) &&
      isSettled(this.cscale, this.tscale)
    );
  }

  get px(): number { return this.cx.pos; }
  get py(): number { return this.cy.pos; }
  get scaleVal(): number { return this.cscale.pos; }

  // Визуальный угол = базовый (пружина) + крен от горизонтальной скорости (инерция).
  get rotation(): number {
    const tilt = clamp(this.cx.vel * anim.tilt.factor, -anim.tilt.max, anim.tilt.max);
    return this.crot.pos + tilt;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
