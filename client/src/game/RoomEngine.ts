import { Application, Container, Graphics, Sprite, Texture, type Ticker } from "pixi.js";
import { CardBody, type CardTargets } from "./CardBody";
import { computeLayout, type RoomLayout } from "./layout";
import { anim } from "./anim/config";
import {
  DEFAULT_ANIMATION_SETTINGS,
  resolveProfile,
  shouldPlay,
  type AnimationProfile,
} from "./anim/animationSettings";
import { ShuffleChoreography } from "./choreo/shuffle";

interface CardVisual {
  body: CardBody;
  sprite: Sprite;
}

// Логический размер текстуры рубашки (соотношение 0.7). Спрайты масштабируются от него.
const TEX_W = 160;
const TEX_H = 228;

// Императивный движок комнаты: владеет ОДНИМ Pixi Application, тикером и всеми объектами.
// Никакого React-реконсайлера и «дерева нод на карту» — карты это простые CardVisual,
// которые мы мутируем сами. Именно это отличает подход от прошлого (@pixi/react + краш).
export class RoomEngine {
  private app: Application | null = null;
  private world: Container | null = null;
  private tableG: Graphics | null = null;
  private cardTex: Texture | null = null;

  private cards: CardVisual[] = [];
  private layout: RoomLayout = computeLayout(1, 1);
  private w = 1;
  private h = 1;
  private baseScale = 1;

  private deckCount = 0;
  private restJitter: number[] = [];
  private profile: AnimationProfile = resolveProfile(DEFAULT_ANIMATION_SETTINGS);
  private destroyed = false;
  private mounted = false;
  private awake = false;
  private shuffleAnim: { choreo: ShuffleChoreography; t: number } | null = null;

  // стрелка — стабильная ссылка для ticker.add/remove
  private readonly tick = (ticker: Ticker) => this.onTick(ticker);

  // Движок сам ВЛАДЕЕТ канвасом: создаёт свежий на каждый mount и вставляет в контейнер.
  // Ключевой момент — НЕ переиспользовать один <canvas> между инстансами: StrictMode
  // монтирует эффект дважды, а второй init на канвасе с уже уничтоженным WebGL-контекстом
  // ловит «context lost» и не компилит шейдеры. Свежий канвас = свежий контекст.
  async mount(container: HTMLElement, w: number, h: number): Promise<void> {
    if (this.mounted || this.destroyed) return; // защита от повторного/позднего mount
    this.mounted = true;
    this.w = Math.max(1, Math.round(w));
    this.h = Math.max(1, Math.round(h));
    this.layout = computeLayout(this.w, this.h);

    const app = new Application();
    await app.init({
      width: this.w,
      height: this.h,
      backgroundAlpha: 0, // прозрачный канвас — под ним пиксельный CSS-фон
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      autoStart: false, // цикл запускаем сами — рендерим только когда что-то движется
    });

    // React мог размонтировать нас, пока шёл await init — тогда просто сворачиваемся.
    if (this.destroyed) {
      app.destroy({ removeView: true }, { children: true, texture: true });
      return;
    }

    container.appendChild(app.canvas);
    this.app = app;
    this.world = new Container();
    this.world.sortableChildren = true; // рендер по zIndex — нужно для чересполосицы половин в риффле
    app.stage.addChild(this.world);

    this.cardTex = this.makeCardBackTexture(app);
    this.baseScale = this.layout.cardH / TEX_H;
    this.buildTable();
    this.reconcileCards();

    app.ticker.add(this.tick);
    this.applyProfile(); // применить текущий профиль (FPS-кап, tilt) к свежему тикеру/картам
    this.wake(); // нарисовать стартовый кадр; следующий тик усыпит, раз всё в покое
  }

  // Разбудить рендер-цикл (что-то будет двигаться). Идемпотентно.
  private wake(): void {
    if (this.destroyed || !this.app || this.awake) return;
    this.awake = true;
    this.app.ticker.start();
  }

  // Усыпить рендер-цикл: в простое ноль rAF/рендеров (не жжёт CPU/GPU, не вешает вкладку).
  private sleep(): void {
    if (!this.app || !this.awake) return;
    this.app.ticker.stop(); // текущий кадр дорисуется, следующий rAF не планируется
    this.awake = false;
  }

  // Сколько карт в собранной колоде (из состояния сервера). Идемпотентно.
  setDeckCount(n: number): void {
    // клампим сверху — защита от абсурдного состояния, чтобы не наплодить тысячи спрайтов
    this.deckCount = Math.min(60, Math.max(0, Math.floor(n)));
    this.ensureJitter(this.deckCount);
    this.reconcileCards();
    this.wake();
  }

  // Запуск анимации растасовки. Реальную тасовку делает сервер — тут только фил.
  shuffle(): void {
    if (this.destroyed || this.cards.length === 0) return;

    // Анимации выключены ИЛИ растасовка не проходит по приоритету → просто уложить стопку.
    if (!shouldPlay(anim.priority.shuffle, this.profile)) {
      this.cards.forEach((c, i) => c.body.snapTo(this.restTarget(i)));
      this.wake();
      return;
    }
    const seed = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
    const choreo = new ShuffleChoreography({
      count: this.cards.length,
      anchor: this.layout.deckAnchor,
      seed,
      // «Умеренный» режим ужимает каскад/разброс и гасит масштабный пульс.
      feel: { stagger: this.profile.stagger, jitter: this.profile.jitter, scaleBump: this.profile.scaleBump ? 1 : 0 },
    });
    // z-порядок по чересполосице: чем позже стартует карта, тем выше слой — половины
    // визуально прошивают друг друга при складывании (riffle-bridge), а не лежат пачками.
    choreo.startOrder().forEach((cardIdx, k) => {
      if (this.cards[cardIdx]) this.cards[cardIdx].sprite.zIndex = k;
    });
    this.shuffleAnim = { choreo, t: 0 };
    this.wake();
  }

  // Применить пользовательский профиль анимации (уровень + скорость → движок).
  setAnimationProfile(profile: AnimationProfile): void {
    this.profile = profile;
    this.applyProfile();
    if (!profile.motion) this.shuffleAnim = null; // без анимаций — оборвать текущую растасовку
    this.wake();
  }

  // Разложить профиль по «железу» движка: FPS-кап тикера + сила крена на всех картах.
  private applyProfile(): void {
    if (this.app) this.app.ticker.maxFPS = this.profile.fpsCap; // 0 = без ограничения
    const tiltScale = this.profile.tilt ? 1 : 0;
    for (const c of this.cards) c.body.tiltScale = tiltScale;
  }

  resize(w: number, h: number): void {
    const nw = Math.max(1, Math.round(w));
    const nh = Math.max(1, Math.round(h));
    if (nw === this.w && nh === this.h) return; // без реальной смены размера — ничего не делаем (гасит ResizeObserver-петли)
    this.w = nw;
    this.h = nh;
    this.layout = computeLayout(this.w, this.h);
    this.baseScale = this.layout.cardH / TEX_H;
    if (this.destroyed || !this.app) return;
    this.app.renderer.resize(this.w, this.h);
    this.buildTable();
    // при ресайзе не анимируем — телепортируем стопку к новому якорю
    this.cards.forEach((c, i) => c.body.snapTo(this.restTarget(i)));
    this.cards.forEach((c) => this.syncSprite(c));
    this.wake();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.shuffleAnim = null;
    if (this.app) {
      this.app.ticker.remove(this.tick); // сперва глушим цикл, потом рушим сцену
      this.app.destroy({ removeView: true }, { children: true, texture: true }); // removeView убирает канвас из DOM
      this.app = null;
    }
    this.world = null;
    this.tableG = null;
    this.cardTex = null;
    this.cards = [];
  }

  // ——— внутреннее ———

  private onTick(ticker: Ticker): void {
    if (this.destroyed || !this.app) return;
    const snap = !this.profile.motion;

    // Скорость (1х/2х/4х) масштабирует время. Интегрируем сабстепами не крупнее maxStepSec —
    // иначе на 4х пружина «взрывается». Реальный лаг кадра тоже клампим (защита от фризов вкладки).
    let remaining = snap ? anim.maxStepSec : Math.min(ticker.deltaMS / 1000, 0.05) * this.profile.speed;
    do {
      const dt = Math.min(remaining, anim.maxStepSec);
      remaining -= dt;

      if (this.shuffleAnim) {
        this.shuffleAnim.t += dt;
        const targets = this.shuffleAnim.choreo.sample(this.shuffleAnim.t);
        for (let i = 0; i < this.cards.length && i < targets.length; i++) {
          this.cards[i].body.setTarget(targets[i]);
        }
        if (this.shuffleAnim.choreo.done(this.shuffleAnim.t)) {
          this.shuffleAnim = null;
          this.cards.forEach((c, i) => (c.sprite.zIndex = i)); // вернуть z-порядок ровной стопки
        }
      }

      for (const c of this.cards) c.body.step(dt, snap);
    } while (remaining > 0 && !snap);

    for (const c of this.cards) this.syncSprite(c);

    // Всё осело и нет активной растасовки → усыпляем цикл до следующего события.
    if (!this.shuffleAnim && this.cards.every((c) => c.body.isResting())) {
      this.sleep();
    }
  }

  private syncSprite(c: CardVisual): void {
    c.sprite.x = c.body.px;
    c.sprite.y = c.body.py;
    c.sprite.rotation = c.body.rotation;
    c.sprite.scale.set(this.baseScale * c.body.scaleVal);
  }

  // Привести число спрайтов к deckCount, новые — уложить в стопку у якоря.
  private reconcileCards(): void {
    if (!this.app || !this.world || !this.cardTex) return;

    while (this.cards.length < this.deckCount) {
      const sprite = new Sprite(this.cardTex);
      sprite.anchor.set(0.5);
      sprite.zIndex = this.cards.length; // покой: выше по стопке = выше в z (совпадает с restTarget по Y)
      const body = new CardBody();
      body.tiltScale = this.profile.tilt ? 1 : 0;
      body.snapTo(this.restTarget(this.cards.length));
      this.world.addChild(sprite);
      this.cards.push({ body, sprite });
    }
    while (this.cards.length > this.deckCount) {
      const c = this.cards.pop()!;
      c.sprite.destroy();
    }
    this.cards.forEach((c) => this.syncSprite(c));
  }

  private restTarget(i: number): CardTargets {
    const a = this.layout.deckAnchor;
    return { x: a.x, y: a.y - i * anim.deck.stackDy, rot: this.restJitter[i] ?? 0, scale: 1 };
  }

  private ensureJitter(n: number): void {
    while (this.restJitter.length < n) {
      this.restJitter.push((Math.random() * 2 - 1) * anim.shuffle.settle.jitter);
    }
  }

  private buildTable(): void {
    if (!this.world) return;
    const g = this.tableG ?? new Graphics();
    g.clear();
    const { table, center } = this.layout;

    // виртуальный овал стола: полупрозрачное сукно + золотая кромка (не буквальный стол)
    g.ellipse(table.cx, table.cy, table.rx, table.ry)
      .fill({ color: 0x123726, alpha: 0.55 })
      .stroke({ width: 6, color: 0xd9b154, alpha: 0.85 });
    // зона центра — тонкое золотое кольцо
    g.ellipse(center.cx, center.cy, center.rx, center.ry).stroke({ width: 3, color: 0xd9b154, alpha: 0.3 });

    if (!this.tableG) {
      this.tableG = g;
      this.world.addChildAt(g, 0); // стол под картами
    }
  }

  private makeCardBackTexture(app: Application): Texture {
    const g = new Graphics();
    g.roundRect(2, 2, TEX_W - 4, TEX_H - 4, 16)
      .fill({ color: 0x14281c })
      .stroke({ width: 5, color: 0xd9b154 });
    g.roundRect(16, 16, TEX_W - 32, TEX_H - 32, 10).stroke({ width: 3, color: 0x3a6b4b });
    // центральный ромб-эмблема в пиксельно-казуальном духе
    const cx = TEX_W / 2;
    const cy = TEX_H / 2;
    g.poly([cx, cy - 34, cx + 26, cy, cx, cy + 34, cx - 26, cy])
      .fill({ color: 0xd9b154, alpha: 0.9 })
      .stroke({ width: 3, color: 0x14281c });
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }
}
