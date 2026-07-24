import { Application, Container, Graphics, Rectangle, Sprite } from "pixi.js";
import { CardBody } from "./CardBody";
import { lightShadowOffset } from "./deckStack";
import type { CardBackId } from "./cardBack";
import { makeCardBackTexture, makeShadowTexture } from "./engine/cardTextures";
import { DRAG_SCALE, SHADOW_ALPHA, TEX_H, TEX_W } from "./engine/constants";

// Живой канвас-грид выбора рубашки. Одна Pixi-сцена (один WebGL-контекст) с сеткой
// ОДИНОЧНЫХ карт — как игровая зона: карты просто лежат по клеткам, без боксов и рамок.
// Каждую можно потянуть, и физика та же, что в игре: карта держится на CardBody (пружины
// + инерционный крен), под ней растёт тень при подъёме, на отпускании — пружинит назад в
// свою клетку (дропзоны тут нет). Одиночный тап выбирает рубашку.
//
// Почему отдельный движок, а не RoomEngine: тот завязан на состояние комнаты (колода,
// места, зоны, сеть). Здесь нужен лишь общий «физический» кирпич — CardBody и текстуры,
// — поэтому берём их напрямую, а всё лишнее не тащим.

const COLS = 4;
const GAP = 0.2; // зазор между клетками — доля ширины карты
const SELECTED_REST_SCALE = 1.06; // выбранная слегка приподнята
const TAP_SLOP = 6; // сдвиг больше этого (px) — уже драг, а не тап
const ACCENT = 0xf2c14e; // --accent-gold: обводка выбранной рубашки
const RING_MARGIN = 10; // отступ обводки наружу от карты (в тексель-координатах)
const RING_WIDTH = 10; // толщина обводки (в тексель-координатах, до baseScale)

interface PickCard {
  id: CardBackId;
  sprite: Sprite;
  shadow: Sprite;
  body: CardBody;
  hx: number; // дом клетки
  hy: number;
}

export class CardBackPicker {
  private app: Application | null = null;
  private destroyed = false;
  private mounted = false;

  private cards: PickCard[] = [];
  private outline: Graphics | null = null;
  private baseScale = 1;
  private cardH = 1;

  private drag: { card: PickCard; offx: number; offy: number; moved: boolean } | null = null;
  private selected: CardBackId | null = null;
  private onSelect: (id: CardBackId) => void = () => {};

  async mount(
    container: HTMLElement,
    width: number,
    ids: CardBackId[],
    selected: CardBackId,
    onSelect: (id: CardBackId) => void,
  ): Promise<void> {
    if (this.mounted || this.destroyed) return;
    this.mounted = true;
    this.selected = selected;
    this.onSelect = onSelect;

    const W = Math.max(1, Math.round(width));
    const cols = Math.min(COLS, ids.length);
    const rows = Math.ceil(ids.length / cols);
    // Ширина клетки из ширины канваса: cols карт + (cols+1) зазоров укладываются в W.
    const cardW = W / (cols + (cols + 1) * GAP);
    const cardH = cardW * (TEX_H / TEX_W);
    const gap = cardW * GAP;
    const H = Math.ceil(rows * cardH + (rows + 1) * gap);
    this.baseScale = cardW / TEX_W;
    this.cardH = cardH;

    const app = new Application();
    try {
      await app.init({
        width: W,
        height: H,
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        autoStart: false,
        preference: "webgl",
      });
    } catch {
      // Нет WebGL (jsdom/тесты) — тихо выходим, канвас просто не появится.
      return;
    }
    if (this.destroyed) {
      app.destroy({ removeView: true }, { children: true, texture: true });
      return;
    }
    container.appendChild(app.canvas);
    this.app = app;

    const shadowLayer = new Container();
    const outlineLayer = new Container(); // под картами: обводка выглядывает каймой из-под карты
    const cardLayer = new Container();
    cardLayer.sortableChildren = true;
    app.stage.addChild(shadowLayer, outlineLayer, cardLayer);
    const shadowTex = makeShadowTexture(app);

    // Обводка выбранной рубашки — рамка вокруг карты, следит за ней (в т.ч. при драге).
    const outline = new Graphics();
    const rw = TEX_W + RING_MARGIN * 2;
    const rh = TEX_H + RING_MARGIN * 2;
    outline.roundRect(-rw / 2, -rh / 2, rw, rh, 24).stroke({ width: RING_WIDTH, color: ACCENT });
    outline.visible = false;
    outlineLayer.addChild(outline);
    this.outline = outline;

    ids.forEach((id, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const hx = gap + col * (cardW + gap) + cardW / 2;
      const hy = gap + row * (cardH + gap) + cardH / 2;

      const tex = makeCardBackTexture(app, id);
      const sprite = new Sprite(tex);
      sprite.label = id;
      sprite.anchor.set(0.5);
      const shadow = new Sprite(shadowTex);
      shadow.anchor.set(0.5);
      shadow.alpha = SHADOW_ALPHA;
      shadow.visible = false;
      shadowLayer.addChild(shadow);
      cardLayer.addChild(sprite);

      const body = new CardBody();
      body.snapTo({ x: hx, y: hy, rot: 0, scale: this.restScale(id) });
      this.cards.push({ id, sprite, shadow, body, hx, hy });
    });

    app.stage.eventMode = "static";
    app.stage.hitArea = new Rectangle(0, 0, W, H);
    app.stage.on("pointerdown", this.onDown);
    app.stage.on("pointermove", this.onMove);
    app.stage.on("pointerup", this.onUp);
    app.stage.on("pointerupoutside", this.onUp);

    app.ticker.add(this.tick);
    this.render();
    this.wake();
  }

  setSelected(id: CardBackId): void {
    if (id === this.selected) return;
    this.selected = id;
    for (const c of this.cards) c.body.setTarget({ scale: this.restScale(c.id) });
    this.wake();
  }

  setOnSelect(fn: (id: CardBackId) => void): void {
    this.onSelect = fn;
  }

  private restScale(id: CardBackId): number {
    return id === this.selected ? SELECTED_REST_SCALE : 1;
  }

  private hitCard(x: number, y: number): PickCard | null {
    // Сверху вниз: перетаскиваемая/выбранная крупнее и лежит выше — её и хотим первой.
    for (let i = this.cards.length - 1; i >= 0; i--) {
      const c = this.cards[i]!;
      const hw = (TEX_W * this.baseScale * c.body.scaleVal) / 2;
      const hh = (TEX_H * this.baseScale * c.body.scaleVal) / 2;
      if (Math.abs(x - c.body.px) <= hw && Math.abs(y - c.body.py) <= hh) return c;
    }
    return null;
  }

  private onDown = (e: { global: { x: number; y: number } }): void => {
    const { x, y } = e.global;
    const card = this.hitCard(x, y);
    if (!card) return;
    this.drag = { card, offx: card.body.px - x, offy: card.body.py - y, moved: false };
    card.sprite.zIndex = 10;
    card.body.setTarget({ scale: DRAG_SCALE });
    this.wake();
  };

  private onMove = (e: { global: { x: number; y: number } }): void => {
    const d = this.drag;
    if (!d) return;
    const { x, y } = e.global;
    if (Math.hypot(x + d.offx - d.card.hx, y + d.offy - d.card.hy) > TAP_SLOP) d.moved = true;
    d.card.body.setTarget({ x: x + d.offx, y: y + d.offy, rot: 0 });
    this.wake();
  };

  private onUp = (): void => {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    // Тап (без сдвига) — выбор рубашки; в любом случае карта пружинит назад в клетку.
    if (!d.moved) this.onSelect(d.card.id);
    d.card.body.setTarget({ x: d.card.hx, y: d.card.hy, rot: 0, scale: this.restScale(d.card.id) });
    d.card.sprite.zIndex = 0;
    this.wake();
  };

  private wake(): void {
    if (this.app && !this.app.ticker.started) this.app.ticker.start();
  }

  private tick = (): void => {
    if (!this.app) return;
    const dt = Math.min(this.app.ticker.deltaMS / 1000, 0.05);
    let moving = this.drag !== null;
    for (const c of this.cards) {
      c.body.step(dt);
      if (!c.body.isResting()) moving = true;
    }
    this.render();
    if (!moving) this.app.ticker.stop(); // всё осело — усыпляем цикл
  };

  private render(): void {
    for (const c of this.cards) {
      const s = c.body.scaleVal * this.baseScale;
      c.sprite.position.set(c.body.px, c.body.py);
      c.sprite.rotation = c.body.rotation;
      c.sprite.scale.set(s);

      const elev = c.body.scaleVal - 1; // насколько карта приподнята над столом
      if (elev > 0.001) {
        const off = lightShadowOffset(this.cardH, elev);
        c.shadow.visible = true;
        c.shadow.position.set(c.body.px + off.dx, c.body.py + off.dy);
        c.shadow.rotation = c.body.rotation;
        c.shadow.scale.set(s);
      } else {
        c.shadow.visible = false;
      }
    }

    // Обводка садится на выбранную карту, повторяя её положение/поворот/масштаб.
    const sel = this.cards.find((c) => c.id === this.selected);
    if (this.outline && sel) {
      this.outline.visible = true;
      this.outline.position.set(sel.body.px, sel.body.py);
      this.outline.rotation = sel.body.rotation;
      this.outline.scale.set(sel.body.scaleVal * this.baseScale);
    } else if (this.outline) {
      this.outline.visible = false;
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (!this.app) return;
    this.app.ticker.remove(this.tick);
    this.app.destroy({ removeView: true }, { children: true, texture: true });
    this.app = null;
    this.cards = [];
    this.outline = null;
  }
}
