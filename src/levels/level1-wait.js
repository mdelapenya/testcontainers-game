/**
 * Level 1 — Wait Strategies.
 * You do not run the test; Testcontainers does. All you choose is how it
 * decides the container is ready — and that choice is the whole game.
 */

import { C, MONO, SERVICES, drawBanner, drawClouds, drawContainer, drawGull, drawHarbour, drawSea, drawSky, meter, panel, roundRect, text } from '../draw.js';
import { mulberry32, randomSeed } from '../rng.js';
import { CATALOG, L1, STRATEGIES, bestStrategy, buildTimeline, costsLife, evaluateChoice, roundLength, timeoutAt } from '../rules.js';
const HORIZON = 300;
const KEYS = { Key1: 'port', Key2: 'log', Key3: 'http', Key4: 'sleep' };
const TONE = { green: C.green, slow: C.amber, flaky: C.red, unsupported: C.red };
const TITLE = {
  green: 'Suite green',
  slow: 'Green, but slow',
  flaky: 'Flaky failure',
  unsupported: 'The wait never fired',
};

class WaitStrategiesLevel {
  constructor() {
    this.id = 1;
  }

  enter(engine) {
    this.engine = engine;
    this.rng = mulberry32(randomSeed());
    this.order = shuffle(CATALOG.map((_, i) => i), this.rng);
    this.round = 0;
    this.lives = L1.LIVES;
    this.score = 0;
    this.greens = 0;
    this.wasted = 0;
    this.flakes = 0;
    this.t = 0;
    this.cards = [];
    this.startRound();
    this.pushHud();
    engine.announce('Level 1, wait strategies. Pick the strategy this service deserves with keys 1 to 4.');
  }

  pushHud() {
    this.engine.hud({ level: 'Level 1 · Wait strategies', score: this.score, lives: this.lives });
  }

  startRound() {
    this.spec = CATALOG[this.order[this.round % this.order.length]];
    this.lines = buildTimeline(this.spec, this.rng);
    this.shown = [];
    this.strategy = null;
    this.outcome = null;
    this.phase = 'choose';
    this.clock = 0;
    this.runFor = 0;
    this.probe = { next: L1.PROBE_START, pips: [], green: false };
  }

  update(dt) {
    this.t += dt;

    for (const code of this.engine.input.takePresses()) this.onKey(code);
    for (const tap of this.engine.input.takeTaps()) {
      if (this.phase === 'choose') {
        const hit = this.cards.find((c) => inside(tap, c));
        if (hit) this.pick(hit.strategy);
      } else if (this.phase === 'result') {
        this.advance();
      }
    }

    if (this.phase === 'run') {
      this.clock += dt * L1.PLAY_SPEED;
      this.streamLogs();
      if (this.strategy === 'http') this.streamProbes();
      this.runFor += dt;
      if (this.runFor >= roundLength(this.spec, this.outcome)) this.reveal();
    } else if (this.phase === 'result') {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) this.advance();
    }
  }

  streamLogs() {
    while (this.lines.length && this.lines[0].t <= this.clock) {
      const line = this.lines.shift();
      this.shown.push(line);
      if (this.shown.length > 7) this.shown.shift();
      if (line.kind === 'ready' && this.strategy === 'log') this.engine.sfx('ready');
    }
  }

  streamProbes() {
    while (this.clock >= this.probe.next) {
      const ok = this.probe.next >= this.spec.readyAt;
      this.probe.pips.push({ t: this.probe.next, ok });
      if (this.probe.pips.length > 8) this.probe.pips.shift();
      if (ok && !this.probe.green) {
        this.probe.green = true;
        this.engine.sfx('ready');
      }
      this.probe.next += L1.PROBE_INTERVAL;
    }
  }

  onKey(code) {
    if (this.phase === 'choose') {
      if (KEYS[code]) this.pick(KEYS[code]);
    } else if (this.phase === 'result') {
      this.advance();
    }
  }

  /** The only decision in the level. Everything after it is deterministic. */
  pick(strategy) {
    this.strategy = strategy;
    this.outcome = evaluateChoice(this.spec, strategy);
    this.phase = 'run';
    this.engine.sfx('spin');
    this.engine.announce(`${STRATEGIES[strategy].name}. Running the test.`);
  }

  reveal() {
    const { verdict, points, wasted, why } = this.outcome;
    this.phase = 'result';
    this.resultTimer = 6;
    this.score += points;

    if (verdict === 'green' || verdict === 'slow') {
      this.greens += 1;
      this.wasted += wasted;
      this.engine.sfx('pass');
    } else {
      this.lives -= 1;
      if (verdict === 'flaky') this.flakes += 1;
      this.engine.sfx('fail');
    }
    this.engine.announce(`${TITLE[verdict]}. ${why}`);
    this.pushHud();
  }

  advance() {
    if (this.phase !== 'result') return;
    if (this.lives <= 0) return this.finish(false);
    this.round += 1;
    if (this.round >= L1.ROUNDS) return this.finish(true);
    this.startRound();
  }

  finish(won) {
    this.engine.hooks.onLevelEnd({
      levelId: 1,
      won,
      score: this.score,
      stats: [
        { label: 'Tests green', value: `${this.greens}/${L1.ROUNDS}` },
        { label: 'Time wasted', value: `${this.wasted.toFixed(1)}s` },
        { label: 'Flaky runs', value: String(this.flakes) },
      ],
      takeaway: won
        ? 'You never timed anything — you picked a signal and Testcontainers did the waiting. That is the whole point: an open port means something is listening, not that it can serve you.'
        : 'Red runs come from signals that fire too early, sleeps that guess wrong, or unsupported checks that time out. Pick the readiness signal the service actually publishes.',
    });
  }

  draw(ctx) {
    const W = 960;
    const H = 540;
    drawSky(ctx, W, H, HORIZON);
    drawClouds(ctx, this.t, W, HORIZON);
    drawHarbour(ctx, W, HORIZON);
    drawSea(ctx, this.t, W, H, HORIZON);
    drawGull(ctx, 830, 90 + Math.sin(this.t * 1.4) * 8, this.t);

    text(ctx, `ROUND ${Math.min(this.round + 1, L1.ROUNDS)} / ${L1.ROUNDS}`, W / 2, 40, {
      size: 13, weight: 700, color: C.navy, align: 'center', alpha: 0.7, letterSpacing: '2px',
    });

    this.drawContainerStage(ctx);
    this.drawLogPanel(ctx);

    if (this.phase === 'choose') this.drawChoice(ctx);
    else this.cards = [];

    if (this.phase === 'run') this.drawRun(ctx);
    if (this.phase === 'result') this.drawResult(ctx);
  }

  drawContainerStage(ctx) {
    const svc = SERVICES[this.spec.service] || SERVICES.postgres;
    const progress = this.phase === 'choose' ? 0 : Math.min(1, this.clock / this.spec.readyAt);
    const bob = Math.sin(this.t * 2) * 4;
    const x = 96;
    const y = 150 + bob;

    drawContainer(ctx, x, y, 190, 110, svc.color, {
      label: this.spec.service,
      state: this.phase === 'choose' ? 'idle' : 'booting',
      progress,
    });
    text(ctx, this.spec.image, x + 95, y + 132, {
      size: 11, weight: 500, color: C.navy, align: 'center', font: MONO, alpha: 0.75,
    });

    if (this.phase === 'choose') return;

    // One badge per signal; only the chosen one is live, and it lights up when
    // that strategy would have released the test.
    Object.values(STRATEGIES).forEach((s, i) => {
      const fires = this.spec.fires[s.key];
      const mine = this.strategy === s.key;
      const on = mine && fires != null && this.clock >= fires;
      const bx = 96 + i * 78;
      panel(ctx, bx, 328, 74, 26, {
        fill: on ? 'rgba(59,178,115,.9)' : 'rgba(8,26,46,.55)',
        stroke: mine ? C.cream : 'rgba(255,255,255,.2)',
        radius: 8,
      });
      tick(ctx, bx + 11, 341, on);
      text(ctx, s.key, bx + 22, 341, {
        size: 11, weight: 600, color: C.cream, baseline: 'middle', font: MONO, alpha: mine ? 1 : 0.4,
      });
    });
  }

  drawLogPanel(ctx) {
    const x = 380;
    const y = 120;
    const w = 500;
    const h = 200;
    panel(ctx, x, y, w, h, { fill: 'rgba(8,26,46,.88)', radius: 12 });
    text(ctx, `$ docker logs -f ${this.spec.service}`, x + 16, y + 26, {
      size: 12, weight: 600, color: C.teal, font: MONO,
    });
    ctx.save();
    roundRect(ctx, x, y + 36, w, h - 36, 12);
    ctx.clip();
    this.shown.forEach((line, i) => {
      const ly = y + 58 + i * 21;
      const isReady = line.kind === 'ready' && this.strategy === 'log';
      if (isReady) {
        panel(ctx, x + 10, ly - 13, w - 20, 20, { fill: 'rgba(59,178,115,.25)', stroke: 'transparent', radius: 4 });
      }
      text(ctx, truncate(line.text, 58), x + 16, ly, {
        size: 11.5, weight: isReady ? 700 : 400, font: MONO,
        color: isReady ? C.green : 'rgba(247,249,253,.72)',
      });
    });
    ctx.restore();

    if (this.strategy === 'http' && this.probe.pips.length) {
      text(ctx, 'probe', x + 16, y + h + 22, { size: 11, weight: 600, color: C.navy, font: MONO });
      this.probe.pips.forEach((p, i) => {
        const px = x + 62 + i * 22;
        ctx.fillStyle = p.ok ? C.green : 'rgba(224,82,99,.75)';
        ctx.beginPath();
        ctx.arc(px, y + h + 18, 7, 0, Math.PI * 2);
        ctx.fill();
        text(ctx, p.ok ? '200' : '503', px, y + h + 36, {
          size: 8, weight: 700, color: C.navy, align: 'center', font: MONO, alpha: 0.8,
        });
      });
    }
  }

  drawChoice(ctx) {
    const W = 960;
    panel(ctx, 40, 348, W - 80, 158, { fill: 'rgba(8,26,46,.9)', radius: 14 });
    text(ctx, `HOW SHOULD TESTCONTAINERS WAIT FOR ${this.spec.service.toUpperCase()}?`, W / 2, 374, {
      size: 13, weight: 800, color: C.teal, align: 'center', letterSpacing: '2px',
    });

    this.cards = Object.values(STRATEGIES).map((s, i) => {
      const w = 205;
      const x = 52 + i * (w + 12);
      const y = 388;
      const h = 104;
      panel(ctx, x, y, w, h, { fill: 'rgba(255,255,255,.07)', stroke: 'rgba(255,255,255,.25)', radius: 10 });
      panel(ctx, x + 12, y + 12, 22, 22, { fill: C.teal, stroke: 'transparent', radius: 6 });
      text(ctx, String(i + 1), x + 23, y + 24, {
        size: 13, weight: 800, color: C.navyDeep, align: 'center', baseline: 'middle',
      });
      text(ctx, s.name, x + 42, y + 28, { size: 13.5, weight: 700, color: C.cream });
      wrap(s.hint, 30).slice(0, 3).forEach((line, n) => {
        text(ctx, line, x + 13, y + 52 + n * 14, { size: 10, weight: 400, color: 'rgba(247,249,253,.7)' });
      });
      text(ctx, s.caption, x + 13, y + 94, { size: 10, weight: 600, color: C.amber });
      return { strategy: s.key, x, y, w, h };
    });
  }

  drawRun(ctx) {
    const W = 960;
    const s = STRATEGIES[this.strategy];
    const limit = timeoutAt(this.spec);
    panel(ctx, 80, 372, W - 160, 120, { fill: 'rgba(8,26,46,.9)', radius: 14 });

    text(ctx, 'WAITING', 110, 402, { size: 12, weight: 800, color: C.teal, letterSpacing: '2px' });
    text(ctx, s.call, 110, 428, { size: 14, weight: 600, color: C.cream, font: MONO });
    text(ctx, `container uptime ${this.clock.toFixed(1)}s`, 110, 458, {
      size: 11.5, weight: 500, color: 'rgba(247,249,253,.65)', font: MONO,
    });

    const dots = '.'.repeat(1 + Math.floor(this.t * 3) % 3);
    text(ctx, `the suite is blocked${dots}`, W - 110, 410, {
      size: 15, weight: 700, color: C.amber, align: 'right',
    });
    meter(ctx, W - 410, 440, 300, 10, Math.min(1, this.clock / limit), { color: C.teal });
    text(ctx, 'you are not doing anything here — that is the point', W - 110, 470, {
      size: 10.5, weight: 500, color: 'rgba(247,249,253,.5)', align: 'right',
    });
  }

  drawResult(ctx) {
    const W = 960;
    const o = this.outcome;
    const tone = TONE[o.verdict];
    drawBanner(ctx, W, 186, TITLE[o.verdict], this.detail(), tone);

    panel(ctx, 80, 366, W - 160, 136, { fill: 'rgba(8,26,46,.92)', radius: 14 });
    text(ctx, STRATEGIES[this.strategy].call, 108, 396, {
      size: 13, weight: 700, color: tone, font: MONO,
    });
    wrap(o.why, 86).slice(0, 3).forEach((line, i) => {
      text(ctx, line, 108, 420 + i * 18, { size: 12, weight: 400, color: 'rgba(247,249,253,.85)' });
    });

    const best = bestStrategy(this.spec);
    if (best !== this.strategy) {
      text(ctx, `best answer: ${STRATEGIES[best].call}`, 108, 484, {
        size: 11.5, weight: 700, color: C.teal, font: MONO,
      });
    } else {
      text(ctx, 'best answer: the one you picked.', 108, 484, {
        size: 11.5, weight: 700, color: C.green, font: MONO,
      });
    }
    text(ctx, 'space or tap to continue', W - 108, 484, {
      size: 11, weight: 600, color: 'rgba(247,249,253,.45)', align: 'right',
    });
  }

  detail() {
    const o = this.outcome;
    if (o.verdict === 'unsupported') return `${this.spec.image} never answers that probe · timed out`;
    if (o.verdict === 'flaky') return `Test started ${Math.abs(o.wasted).toFixed(2)}s before ${this.spec.service} was ready`;
    if (o.verdict === 'slow') return `Passed, after ${o.wasted.toFixed(2)}s of dead time · +${o.points}`;
    return `Started ${o.wasted.toFixed(2)}s after readiness · +${o.points}`;
  }
}

/** A tick when the signal has fired, a dot while it has not. */
function tick(ctx, x, y, on) {
  ctx.save();
  ctx.strokeStyle = C.cream;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (on) {
    ctx.moveTo(x - 4, y);
    ctx.lineTo(x - 1, y + 3.5);
    ctx.lineTo(x + 4.5, y - 4);
    ctx.stroke();
  } else {
    ctx.globalAlpha = 0.5;
    ctx.arc(x, y, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = C.cream;
    ctx.fill();
  }
  ctx.restore();
}

/** Fisher-Yates with the level's seeded rng, so a run is reproducible. */
function shuffle(items, rng) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Greedy word wrap to lines of at most `n` characters. */
function wrap(s, n) {
  const lines = [];
  let line = '';
  for (const word of s.split(' ')) {
    const next = line ? line + ' ' + word : word;
    if (next.length > n && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function inside(p, r) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export { WaitStrategiesLevel };
