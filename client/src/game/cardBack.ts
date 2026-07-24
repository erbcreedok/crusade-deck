// Скины рубашки карт: описание (палитра + вид узора) и чистая математика раскладки узора.
// Рисует по этим числам движок (makeCardBackTexture) — сюда Pixi не заглядывает, поэтому
// геометрия узора тестируется юнитами. Скинов пока два, список рассчитан на пополнение.

export type CardBackId =
  | "ruby"
  | "mosaic"
  | "emerald"
  | "amethyst"
  | "ember"
  | "steel"
  | "sunburst"
  | "bubble";

// Кайма по краю рубашки. По умолчанию — белая («как у настоящих карт»); это ЖЕЛАЕМЫЙ
// стиль, а не правило: скин может выставить "none" и рисоваться без белой рамки (узор до
// края в цветной обводке). Дефолт даёт опущенное поле, чтобы не помечать каждый скин.
export type CardBackEdge = "white" | "none";

export interface CardBackSkin {
  id: CardBackId;
  label: string;
  pattern: "lattice" | "mosaic" | "dots"; // какой узор рисовать
  bg: number; // фон карты
  border: number; // рамка по краю
  inner: number; // внутренняя рамка/обводка фигур
  ink: number[]; // палитра узора (мозаика — по числу оттенков; точки/решётка — два)
  edge?: CardBackEdge; // кайма по краю; по умолчанию "white"
}

export const CARD_BACKS: CardBackSkin[] = [
  {
    id: "ruby",
    label: "Рубин",
    pattern: "lattice",
    bg: 0xf4ecd8,
    border: 0xc0392b,
    inner: 0x8e2a1f,
    ink: [0xc0392b, 0xe8574a],
  },
  {
    id: "emerald",
    label: "Изумруд",
    pattern: "lattice",
    bg: 0xe8f0e0,
    border: 0x1f5c39,
    inner: 0x184a2d,
    ink: [0x2f7d4f, 0x3fa06a],
  },
  {
    id: "amethyst",
    label: "Аметист",
    pattern: "lattice",
    bg: 0xefe6f5,
    border: 0x5a2d78,
    inner: 0x46215e,
    ink: [0x7b3fa0, 0x9b5fc0],
  },
  {
    id: "mosaic",
    label: "Мозаика",
    pattern: "mosaic",
    bg: 0x0c1220,
    border: 0x2b6cb0,
    inner: 0x0a0f1a,
    ink: [0x14304f, 0x1d4f7c, 0x2b6cb0],
  },
  {
    id: "ember",
    label: "Угли",
    pattern: "mosaic",
    bg: 0x1a0e0a,
    border: 0xe0671f,
    inner: 0x120806,
    ink: [0x4a1d0e, 0x7a2f14, 0xb3491f],
  },
  {
    id: "steel",
    label: "Сталь",
    pattern: "mosaic",
    bg: 0x0d1417,
    border: 0x4f8f9e,
    inner: 0x0a0f11,
    ink: [0x1c2e33, 0x2c4a52, 0x3d6b76],
  },
  {
    id: "sunburst",
    label: "Закат",
    pattern: "dots",
    bg: 0x201603,
    border: 0xffd95e,
    inner: 0x3a2a08,
    ink: [0xe0a63a, 0xf2c85a],
  },
  {
    id: "bubble",
    label: "Пузыри",
    pattern: "dots",
    bg: 0x08121f,
    border: 0x3fc0d6,
    inner: 0x0a1a24,
    ink: [0x1d6c7c, 0x2f9db0],
  },
];

export const DEFAULT_CARD_BACK: CardBackId = "ruby";

export function isCardBackId(v: unknown): v is CardBackId {
  return typeof v === "string" && CARD_BACKS.some((s) => s.id === v);
}

export function cardBackSkin(id: CardBackId): CardBackSkin {
  return CARD_BACKS.find((s) => s.id === id) ?? CARD_BACKS[0];
}

export interface LatticePoint {
  x: number;
  y: number;
  odd: boolean; // шахматный признак: ромб или квадрат (узор «квадраторомб»)
}

// Центры фигур решётки: cols×rows равномерно по полю с отступом margin от краёв.
export function latticeCenters(w: number, h: number, cols: number, rows: number, margin: number): LatticePoint[] {
  if (cols <= 0 || rows <= 0) return [];
  const innerW = Math.max(0, w - margin * 2);
  const innerH = Math.max(0, h - margin * 2);
  const stepX = innerW / cols;
  const stepY = innerH / rows;
  const pts: LatticePoint[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      pts.push({
        x: margin + stepX * (col + 0.5),
        y: margin + stepY * (row + 0.5),
        odd: (col + row) % 2 === 1,
      });
    }
  }
  return pts;
}

export interface MosaicTile {
  x: number;
  y: number;
  w: number;
  h: number;
  shade: number; // индекс в палитре ink
}

// Плитки мозаики: cols×rows встык (без дыр и нахлёстов) по полю с отступом margin.
// Оттенок детерминирован от позиции — узор одинаков на каждой карте и в тестах.
export function mosaicTiles(w: number, h: number, cols: number, rows: number, margin: number): MosaicTile[] {
  if (cols <= 0 || rows <= 0) return [];
  const innerW = Math.max(0, w - margin * 2);
  const innerH = Math.max(0, h - margin * 2);
  const tw = innerW / cols;
  const th = innerH / rows;
  const tiles: MosaicTile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      tiles.push({
        x: margin + tw * col,
        y: margin + th * row,
        w: tw,
        h: th,
        shade: (col * 7 + row * 13 + ((col * row) % 5)) % 3,
      });
    }
  }
  return tiles;
}
