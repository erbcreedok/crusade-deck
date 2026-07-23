// Константы движка комнаты. Вынесены из RoomEngine, чтобы отрисовочные модули
// (текстуры, места, зоны) могли ссылаться на те же числа без импорта самого движка.

/** Логический размер текстуры карты (соотношение 0.7). Спрайты масштабируются от него. */
export const TEX_W = 160;
export const TEX_H = 228;

/** Нулевая тряска — общий объект, чтобы не аллоцировать его каждый кадр. */
export const ZERO_SHAKE = { dx: 0, dy: 0, rot: 0 } as const;

/** Надпись «сюда нельзя» при запрещённом дропе колоды. */
export const REJECT_TEXT = "низяяя";

/**
 * Клич «ГОУ!»: дилер объявил начало игры, и это видит весь стол. Родня «низяяя» по духу
 * (крупная надпись поверх карт), но противоположная по смыслу — поэтому огненная.
 * Эмодзи вынесены отдельными надписями: пиксельный VT323 их не содержит, и рисует их
 * системный шрифт (см. buildOverlays).
 */
export const SHOUT_TEXT = "ГОООООУУУ!!!";
export const SHOUT_EMOJI = "🔥";
/** Шрифт эмодзи: системный, пиксельного тут не существует. */
export const EMOJI_FONT = "'Apple Color Emoji', 'Noto Color Emoji', 'Segoe UI Emoji', sans-serif";
/** Огонь: жёлто-оранжевая заливка, тёмно-красная обводка. */
export const SHOUT_COLORS = { fill: 0xffc233, stroke: 0x7d1b06 } as const;

/** Кромка карты (толщина бумаги): низ светло-серый, бока темнее — свет сверху справа. */
export const CARD_EDGE = { bottom: 0xa8a8a8, side: 0x6e6e6e, width: 4 } as const;

// Пока колода на столе одна, но выделение устроено по id — когда колод станет
// несколько, поменяется только источник этого значения.
export const DECK_ID = "deck";
/**
 * Отдельная стопка: МОЯ рука (Player.hand). Не путать с DropZone "hand" (куда раньше
 * тащили всю колоду).
 */
export const HAND_ID = "hand";

/** Карты «приподнимаются» при захвате (визуальный акцент). */
export const DRAG_SCALE = 1.18;
/** px: меньше — это тап (дабл-клик), больше — реальный драг. */
export const DRAG_THRESHOLD = 6;

/** Общий шрифт всех надписей на канвасе (пиксельный, как и весь UI). */
export const PIXEL_FONT = "VT323, monospace";

/** Палитра канваса: золото подписей, «горячий» ховер, кремовое лицо карты. */
export const COLORS = {
  gold: 0xd9b154,
  hot: 0xffe9a8,
  cardFace: 0xf4ecd8,
  seatName: 0xf5ead0,
  seatNameOff: 0x9aa8a2,
  seatCount: 0xcdb98f,
  dealerBorder: 0xf2c14e,
  seatBorder: 0x8fa39a,
  seatBorderOff: 0x5d6b64,
  ink: 0x1a1f1c,
} as const;

/** zIndex слоёв мира: чем больше, тем ближе к игроку. */
export const Z = {
  table: 0,
  seats: 0.5,
  zones: 1,
  shadows: 2,
  cards: 3,
  deckBody: 0.5, // внутри слоя карт: над нижней картой, под остальными
  focus: 9000,
  counters: 9200,
  rejectText: 5000,
  shout: 5100, // клич «ГОУ!» — над отказом: он про весь стол, а не про одну карту
  deckHit: 10_000,
  handHit: 10_100,
  collapseBtn: 10_500, // ВЫШЕ хит-зоны колоды: иначе её съедала полоса веера
  handCards: 2000,
  splash: 50_000,
  flight: 80_000,
  draggedCard: 100_000,
} as const;
