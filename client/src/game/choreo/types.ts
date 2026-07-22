import type { CardTargets } from "../CardBody";

// Общий контракт хореографии растасовки: по времени t выдаёт ЦЕЛИ карт, а движок
// скармливает их пружинам. Есть две реализации — риффл (полная) и спин (умеренная).
export interface Choreography {
  readonly durationSec: number;
  sample(tSec: number): CardTargets[];
  done(tSec: number): boolean;
  // Порядок карт по старту (для z-порядка). Риффл чередует половины, спин — натуральный.
  startOrder(): number[];
}
