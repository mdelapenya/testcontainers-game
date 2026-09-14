/**
 * Fixed-timestep game loop, canvas scaling and input plumbing.
 * Scenes implement: enter(engine), update(dt), draw(ctx), exit().
 */

const STEP = 1 / 60;
const MAX_FRAME = 0.25;

const VIEW = { w: 960, h: 540 };

class Input {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.engine = engine;
    /** @type {Set<string>} keys currently held */
    this.held = new Set();
    /** @type {string[]} keys pressed since the last update */
    this.presses = [];
    /** @type {{x:number,y:number}[]} taps since the last update */
    this.taps = [];

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      const code = normalise(e.code);
      if (!code) return;
      if (code === 'Space' || code.startsWith('Arrow')) e.preventDefault();
      this.held.add(code);
      this.presses.push(code);
    };
    this._onKeyUp = (e) => this.held.delete(normalise(e.code));
    this._onBlur = () => this.held.clear();
    this._onPointer = (e) => {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      this.taps.push({
        x: ((e.clientX - r.left) / r.width) * VIEW.w,
        y: ((e.clientY - r.top) / r.height) * VIEW.h,
        touch: e.pointerType !== 'mouse',
      });
      canvas.focus({ preventScroll: true });
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    canvas.addEventListener('pointerdown', this._onPointer);
  }

  /** Feed a synthetic key press (used by the on-screen touch buttons). */
  virtualPress(code) {
    this.presses.push(code);
    this.held.add(code);
  }

  virtualRelease(code) {
    this.held.delete(code);
  }

  isHeld(code) {
    return this.held.has(code);
  }

  takePresses() {
    const out = this.presses;
    this.presses = [];
    return out;
  }

  takeTaps() {
    const out = this.taps;
    this.taps = [];
    return out;
  }

  clear() {
    this.held.clear();
    this.presses.length = 0;
    this.taps.length = 0;
  }
}

function normalise(code) {
  if (!code) return '';
  // Digit1 / Numpad1 both mean "1".
  if (/^(Digit|Numpad)[1-9]$/.test(code)) return 'Key' + code.slice(-1);
  return code;
}

class Engine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{onHud:(state:object)=>void, announce:(msg:string)=>void, audio:object}} hooks
   */
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks;
    this.input = new Input(canvas, this);
    this.scene = null;
    this.paused = false;
    this.time = 0;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this._acc = 0;
    this._last = 0;
    this._raf = 0;
    this._frame = this._frame.bind(this);

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(VIEW.w * dpr);
    const h = Math.round(VIEW.h * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setScene(scene) {
    if (this.scene && this.scene.exit) this.scene.exit();
    this.input.clear();
    this.paused = false;
    this.scene = scene;
    this._acc = 0;
    if (scene && scene.enter) scene.enter(this);
  }

  setPaused(paused) {
    this.paused = paused;
    if (!paused) this._last = performance.now();
    this.input.clear();
  }

  hud(state) {
    this.hooks.onHud(state);
  }

  announce(message) {
    this.hooks.announce(message);
  }

  sfx(name) {
    this.hooks.audio.play(name);
  }

  start() {
    if (this._raf) return;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._frame);
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _frame(now) {
    this._raf = requestAnimationFrame(this._frame);
    const elapsed = Math.min((now - this._last) / 1000, MAX_FRAME);
    this._last = now;

    if (!this.scene) return;
    if (!this.paused) {
      this._acc += elapsed;
      let guard = 0;
      const running = this.scene;
      while (this._acc >= STEP && guard++ < 8) {
        this.time += STEP;
        this.scene.update(STEP);
        this._acc -= STEP;
        // A level can end inside its own update, which swaps the scene out
        // from under us: stop stepping the one that just left.
        if (this.scene !== running) break;
      }
    } else {
      this.input.takePresses();
      this.input.takeTaps();
    }
    if (!this.scene) return;
    this.ctx.clearRect(0, 0, VIEW.w, VIEW.h);
    this.scene.draw(this.ctx);
  }
}

export { VIEW, Engine };
