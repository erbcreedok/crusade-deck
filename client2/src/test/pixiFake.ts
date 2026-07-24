// Фейк Pixi для тестов движка комнаты.
//
// RoomEngine — императивный: он владеет Application, тикером и всеми объектами сцены,
// поэтому проверить его чистыми модулями нельзя, а настоящий Pixi в jsdom не поднимется
// (нет WebGL). Фейк повторяет ровно ту часть API, которой пользуется движок: дерево
// контейнеров, спрайты с текстурами, Graphics-цепочки, тексты и тикер, которым тест
// управляет вручную.
//
// Использование:
//   vi.mock("pixi.js", async () => (await import("./test/pixiFake")).pixiFake());
//   const pixi = (await import("pixi.js")) as unknown as PixiFake;
//   pixi.__apps[0].ticker.__advance(16);

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PixiFake {
  /** Все созданные приложения (движок создаёт по одному на mount). */
  __apps: any[];
  /** Живые (не уничтоженные) спрайты — по ним видно, сколько карт на сцене. */
  __liveSprites: () => any[];
  __reset: () => void;
  [key: string]: any;
}

export function pixiFake(): PixiFake {
  const apps: any[] = [];
  const sprites: any[] = [];

  class Point {
    x = 0;
    y = 0;
    set(x: number, y = x): void {
      this.x = x;
      this.y = y;
    }
  }

  class Container {
    children: any[] = [];
    parent: Container | null = null;
    label = "";
    x = 0;
    y = 0;
    rotation = 0;
    alpha = 1;
    tint = 0xffffff;
    visible = true;
    zIndex = 0;
    sortableChildren = false;
    eventMode = "auto";
    cursor = "";
    hitArea: any = null;
    destroyed = false;
    scale = new Point();
    position = new Point();
    private handlers = new Map<string, ((e: any) => void)[]>();

    constructor() {
      this.scale.set(1);
    }

    addChild(...kids: any[]): any {
      for (const kid of kids) {
        kid.parent = this;
        this.children.push(kid);
      }
      return kids[0];
    }

    removeChild(kid: any): void {
      const i = this.children.indexOf(kid);
      if (i >= 0) this.children.splice(i, 1);
      kid.parent = null;
    }

    on(event: string, fn: (e: any) => void): this {
      const list = this.handlers.get(event) ?? [];
      list.push(fn);
      this.handlers.set(event, list);
      return this;
    }

    /** Позвать обработчик, как это сделал бы Pixi при событии указателя. */
    __emit(event: string, payload: any = {}): void {
      for (const fn of this.handlers.get(event) ?? []) fn(payload);
    }

    setFromMatrix(_m: any): void {
      /* поза из матрицы: для структурных проверок содержимое неважно */
    }

    destroy(_opts?: any): void {
      this.destroyed = true;
      this.parent?.removeChild(this);
      for (const kid of [...this.children]) kid.destroy?.(_opts);
      this.children = [];
    }
  }

  class Texture {
    destroyed = false;
    destroy(): void {
      this.destroyed = true;
    }
  }

  class Sprite extends Container {
    texture: any;
    anchor = new Point();
    constructor(texture?: any) {
      super();
      this.texture = texture ?? new Texture();
      sprites.push(this);
    }
  }

  class Graphics extends Container {
    /** Сколько раз рисовали: тест может убедиться, что перерисовка вообще случилась. */
    ops = 0;
    private chain(): this {
      this.ops += 1;
      return this;
    }
    clear(): this {
      this.ops = 0;
      return this;
    }
    roundRect(): this {
      return this.chain();
    }
    rect(): this {
      return this.chain();
    }
    circle(): this {
      return this.chain();
    }
    poly(): this {
      return this.chain();
    }
    moveTo(): this {
      return this.chain();
    }
    lineTo(): this {
      return this.chain();
    }
    arcTo(): this {
      return this.chain();
    }
    arc(): this {
      return this.chain();
    }
    fill(): this {
      return this.chain();
    }
    stroke(): this {
      return this.chain();
    }
  }

  class Text extends Container {
    text: string;
    style: any;
    anchor = new Point();
    constructor(opts: { text?: string; style?: any } = {}) {
      super();
      this.text = opts.text ?? "";
      this.style = { ...(opts.style ?? {}) };
    }
  }

  class Rectangle {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
    contains(px: number, py: number): boolean {
      return px >= this.x && px <= this.x + this.width && py >= this.y && py <= this.y + this.height;
    }
  }

  class Circle {
    constructor(
      public x = 0,
      public y = 0,
      public radius = 0,
    ) {}
    contains(px: number, py: number): boolean {
      return Math.hypot(px - this.x, py - this.y) <= this.radius;
    }
  }

  class Matrix {
    constructor(
      public a = 1,
      public b = 0,
      public c = 0,
      public d = 1,
      public tx = 0,
      public ty = 0,
    ) {}
  }

  class Ticker {
    maxFPS = 0;
    started = false;
    listeners: ((t: any) => void)[] = [];
    add(fn: (t: any) => void): void {
      this.listeners.push(fn);
    }
    remove(fn: (t: any) => void): void {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    }
    start(): void {
      this.started = true;
    }
    stop(): void {
      this.started = false;
    }
    /** Проиграть кадр вручную: движок обычно живёт на rAF, тест — на этом методе. */
    __advance(deltaMS = 16): void {
      for (const fn of [...this.listeners]) fn({ deltaMS });
    }
  }

  class Application {
    canvas: HTMLCanvasElement = document.createElement("canvas");
    stage = new Container();
    ticker = new Ticker();
    destroyed = false;
    renderer = {
      resize: (w: number, h: number) => {
        this.canvas.width = w;
        this.canvas.height = h;
      },
      generateTexture: () => new Texture(),
    };
    constructor() {
      apps.push(this);
    }
    async init(_opts?: any): Promise<void> {
      /* настоящий init поднимает WebGL — здесь достаточно самого факта */
    }
    destroy(opts?: any): void {
      this.destroyed = true;
      this.stage.destroy();
      if (opts?.removeView) this.canvas.remove();
    }
  }

  return {
    Application,
    Container,
    Graphics,
    Sprite,
    Text,
    Texture,
    Rectangle,
    Circle,
    Matrix,
    Ticker,
    Point,
    __apps: apps,
    __liveSprites: () => sprites.filter((s) => !s.destroyed),
    __reset: () => {
      apps.length = 0;
      sprites.length = 0;
    },
  };
}
