/**
 * Level 4 — Ryuk. A shared Docker host, littered with leftovers from several
 * builds at once. You are the reaper: walk the host and collect everything
 * carrying your own session label, and nothing else. The resources still
 * moving belong to builds that are running right now.
 */

import { C, MONO, drawBanner, drawClouds, drawHarbour, drawSea, drawSky, meter, panel, roundRect, text, } from '../draw.js';
import { mulberry32, randomSeed } from '../rng.js';
import { DIRS, HostBoard, L4, SPOILS } from '../rules.js';
const HORIZON = 220;
/** The HUD chips own the top 44px, so the host starts well below them. */
const AREA = { x: 300, y: 88, w: 620, h: 330 };
const SIDE = { x: 40, w: 226 };
const STRIP = { x: 40, y: 430, w: 880, h: 78 };
const MAX_CELL = 40;

const MOVES = {
  ArrowUp: 'n', ArrowDown: 's', ArrowLeft: 'w', ArrowRight: 'e',
  KeyW: 'n', KeyS: 's', KeyA: 'w', KeyD: 'e',
};

const KIND_COLOR = {
  container: C.teal,
  network: C.whaleLite,
  volume: C.amber,
};

class RyukLevel {
  constructor() {
    this.id = 4;
  }

  enter(engine) {
    this.engine = engine;
    this.rng = mulberry32(randomSeed());
    this.t = 0;
    this.round = 0;
    this.lives = L4.LIVES;
    this.score = 0;
    this.cleaned = 0;
    this.reapedTotal = 0;
    this.startBoard();
    this.pushHud();
  }

  pushHud() {
    this.engine.hud({ level: 'Level 4 · Ryuk', score: this.score, lives: this.lives });
  }

  startBoard() {
    this.spec = L4.BOARDS[this.round];
    this.board = new HostBoard({ rng: this.rng, ...this.spec });
    this.phase = 'play';
    this.want = null;
    this.stepT = 0;
    // A second of grace: nothing should die before it has moved once.
    this.strayT = -1;
    this.timer = 0;
    this.layout();
    this.toast = {
      tone: C.teal,
      title: `Your session is ${this.board.session} — reap that label and only that label.`,
      body: `${this.spec.mine} resources are yours. The rest belong to builds sharing this host; touching one is how you become the person who broke CI.`,
    };
    this.engine.announce(`Host ${this.round + 1}. Your session label is ${this.board.session}.`);
  }

  /** Cell size and origin, so any host plan lands centred in the same box. */
  layout() {
    const { cols, rows } = this.board;
    this.cell = Math.min(Math.floor(AREA.w / cols), Math.floor(AREA.h / rows), MAX_CELL);
    this.gx = AREA.x + Math.round((AREA.w - cols * this.cell) / 2);
    this.gy = AREA.y + Math.round((AREA.h - rows * this.cell) / 2);
  }

  update(dt) {
    this.t += dt;
    for (const code of this.engine.input.takePresses()) this.onKey(code);
    for (const tap of this.engine.input.takeTaps()) this.onTap(tap);
    // Held keys are only a fallback, for the player who is already leaning on a
    // direction when a host loads. Scanning them unconditionally used to run
    // after the press queue and overwrite it, so turning while still holding the
    // previous key was silently thrown away — every frame, until you let go.
    if (!this.want) {
      for (const code of Object.keys(MOVES)) {
        if (this.engine.input.isHeld(code)) {
          this.want = MOVES[code];
          break;
        }
      }
    }

    if (this.phase === 'play') {
      this.runBoard(dt);
      return;
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    if (this.phase === 'won') this.nextBoard();
    else if (this.lives <= 0) this.finish(false);
    else this.startBoard();
  }

  runBoard(dt) {
    this.stepT += dt;
    while (this.phase === 'play' && this.stepT >= L4.STEP) {
      this.stepT -= L4.STEP;
      this.stepReaper();
    }
    this.strayT += dt;
    while (this.phase === 'play' && this.strayT >= L4.STRAY_STEP) {
      this.strayT -= L4.STRAY_STEP;
      const before = this.board.strays.map((s) => ({ x: s.x, y: s.y }));
      this.board.stepStrays();
      if (this.board.strayHit(before)) this.caught();
    }
    if (this.phase === 'play' && this.board.tick(dt)) this.timeout();
  }

  stepReaper() {
    const wanted = this.want && dirOfName(this.want);
    const { reaper } = this.board;
    if (wanted && !this.board.isWall(reaper.x + wanted.dx, reaper.y + wanted.dy)) reaper.dir = wanted;
    if (!reaper.dir) return;

    const step = this.board.moveReaper(reaper.dir);
    if (!step.moved) return;
    if (step.item) this.picked(step.item);
    if (this.phase === 'play' && this.board.strayHit()) this.caught();
  }

  /* ---------------------------------------------------------------- */
  /* Input                                                             */
  /* ---------------------------------------------------------------- */

  onKey(code) {
    if (this.phase !== 'play') return;
    if (MOVES[code]) this.want = MOVES[code];
  }

  /** Tapping the host steers towards the tap, which is all a phone can do. */
  onTap(tap) {
    if (this.phase !== 'play') return;
    const { reaper } = this.board;
    const cx = this.gx + (reaper.x + 0.5) * this.cell;
    const cy = this.gy + (reaper.y + 0.5) * this.cell;
    const dx = tap.x - cx;
    const dy = tap.y - cy;
    if (Math.abs(dx) < this.cell / 2 && Math.abs(dy) < this.cell / 2) return;
    this.want = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
  }

  /* ---------------------------------------------------------------- */
  /* Outcomes                                                          */
  /* ---------------------------------------------------------------- */

  picked(item) {
    const spoil = SPOILS.find((s) => s.kind === item.kind);
    if (!item.mine) {
      this.fail(
        'That label was not yours.',
        `The ${spoil.label} you just removed was tagged session=${item.session}. Somewhere another build is now staring at a container that vanished mid-test.`,
      );
      return;
    }
    this.score += L4.POINTS_ITEM;
    this.reapedTotal += 1;
    this.pushHud();
    this.engine.sfx('pick');
    this.toast = {
      tone: C.green,
      title: `Reaped a ${spoil.label} · +${L4.POINTS_ITEM}`,
      body: `Tagged session=${this.board.session}, so it was always going to go. ${this.board.remaining} left on this host.`,
    };
    if (this.board.over) this.win();
  }

  caught() {
    this.fail(
      'A running build walked into you.',
      'Those resources are tagged with a session that is still alive. Ryuk waits for its own containers to be done; it never fights another build for the host.',
    );
  }

  timeout() {
    this.fail(
      'The host is still dirty.',
      `Time ran out with ${this.board.remaining} of your own resources left behind. That is the leak everyone ends up blaming on Docker.`,
    );
  }

  win() {
    const bonus = this.board.bonus;
    this.score += bonus;
    this.cleaned += 1;
    this.phase = 'won';
    this.timer = 2.8;
    this.pushHud();
    this.engine.sfx('pass');
    this.toast = {
      tone: C.green,
      title: `Host clean · +${bonus} for ${Math.round(this.board.left)}s to spare`,
      body: `Every resource labelled ${this.board.session} is gone and every other build on this host never noticed you were here.`,
    };
    this.engine.announce(this.toast.title);
  }

  fail(title, body) {
    this.lives -= 1;
    this.phase = 'lost';
    this.timer = 2.8;
    this.pushHud();
    this.engine.sfx('fail');
    this.toast = { tone: C.red, title, body };
    this.engine.announce(`${title} ${body}`);
  }

  nextBoard() {
    this.round += 1;
    if (this.round >= L4.ROUNDS) return this.finish(true);
    this.startBoard();
  }

  finish(won) {
    this.engine.hooks.onLevelEnd({
      levelId: 4,
      won,
      score: this.score,
      stats: [
        { label: 'Hosts cleaned', value: `${this.cleaned}/${L4.ROUNDS}` },
        { label: 'Resources reaped', value: this.reapedTotal },
        { label: 'Lives left', value: Math.max(0, this.lives) },
      ],
      takeaway: 'Testcontainers labels everything it creates with a session id, and Ryuk reaps exactly that label. That is why you never need a shutdown hook, and why cleanup is safe on a host shared with other builds.',
    });
  }

  /* ---------------------------------------------------------------- */
  /* Drawing                                                           */
  /* ---------------------------------------------------------------- */

  draw(ctx) {
    drawSky(ctx, 960, 540, HORIZON);
    drawClouds(ctx, this.t, 960, HORIZON);
    drawHarbour(ctx, 960, HORIZON);
    drawSea(ctx, this.t, 960, 540, HORIZON);

    text(ctx, `HOST ${this.round + 1} / ${L4.ROUNDS}`, 40, 68, {
      size: 18, weight: 800, color: C.navy, font: MONO,
    });
    this.drawSide(ctx);
    this.drawMaze(ctx);
    this.drawItems(ctx);
    this.drawStrays(ctx);
    this.drawReaper(ctx);
    this.drawStrip(ctx);

    if (this.phase === 'won') {
      drawBanner(ctx, 960, 186, 'Host clean', `Nothing left tagged ${this.board.session}`, C.green);
    } else if (this.phase === 'lost') {
      drawBanner(ctx, 960, 186, this.toast.title, this.lives > 0 ? 'One life gone. A fresh host, a fresh session.' : 'No lives left.', C.red);
    }
  }

  drawSide(ctx) {
    panel(ctx, SIDE.x, 88, SIDE.w, 88, { fill: 'rgba(8,26,46,.95)', radius: 12 });
    text(ctx, 'YOUR SESSION LABEL', SIDE.x + 16, 110, {
      size: 10, weight: 800, color: C.slate, font: MONO, letterSpacing: '1px',
    });
    text(ctx, 'org.testcontainers', SIDE.x + 16, 132, { size: 12, weight: 600, color: C.cream, font: MONO });
    text(ctx, `.session=${this.board.session}`, SIDE.x + 16, 150, { size: 14, weight: 800, color: C.teal, font: MONO });
    text(ctx, 'reap this and nothing else', SIDE.x + 16, 166, { size: 10, weight: 600, color: C.slate });

    panel(ctx, SIDE.x, 188, SIDE.w, 166, { fill: 'rgba(8,26,46,.95)', radius: 12 });
    text(ctx, 'ON THIS HOST', SIDE.x + 16, 210, {
      size: 10, weight: 800, color: C.slate, font: MONO, letterSpacing: '1px',
    });
    SPOILS.forEach((spoil, i) => {
      const y = 234 + i * 24;
      drawSpoil(ctx, spoil.kind, SIDE.x + 26, y, 19, KIND_COLOR[spoil.kind], true);
      text(ctx, `${spoil.label} · yours`, SIDE.x + 44, y + 4, { size: 12, weight: 700, color: C.cream });
    });
    drawSpoil(ctx, 'container', SIDE.x + 26, 312, 19, C.slate, false);
    text(ctx, 'another session', SIDE.x + 44, 316, { size: 12, weight: 700, color: C.red });
    drawGhost(ctx, SIDE.x + 26, 338, 19, C.red, this.t);
    text(ctx, 'a build still running', SIDE.x + 44, 342, { size: 12, weight: 700, color: C.red });

    panel(ctx, SIDE.x, 364, SIDE.w, 52, { fill: 'rgba(8,26,46,.95)', radius: 12 });
    text(ctx, 'LEFT TO REAP', SIDE.x + 16, 386, {
      size: 10, weight: 800, color: C.slate, font: MONO, letterSpacing: '1px',
    });
    text(ctx, String(this.board.remaining), SIDE.x + SIDE.w - 16, 402, {
      size: 26, weight: 800, color: C.teal, align: 'right', font: MONO,
    });
    text(ctx, `${this.board.reaped} reaped`, SIDE.x + 16, 404, { size: 12, weight: 600, color: C.cream });
  }

  drawMaze(ctx) {
    const { cols, rows } = this.board;
    const w = cols * this.cell;
    const h = rows * this.cell;
    panel(ctx, this.gx - 8, this.gy - 8, w + 16, h + 16, { fill: 'rgba(8,26,46,.94)', radius: 14 });
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!this.board.isWall(x, y)) continue;
        const px = this.gx + x * this.cell;
        const py = this.gy + y * this.cell;
        roundRect(ctx, px, py, this.cell, this.cell, 3);
        ctx.fillStyle = C.navy;
        ctx.fill();
        ctx.strokeStyle = 'rgba(195,199,230,.18)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  drawItems(ctx) {
    for (const item of this.board.items) {
      if (item.taken) continue;
      const cx = this.gx + (item.x + 0.5) * this.cell;
      const cy = this.gy + (item.y + 0.5) * this.cell;
      const color = item.mine ? KIND_COLOR[item.kind] : C.slate;
      drawSpoil(ctx, item.kind, cx, cy - 5, this.cell * 0.52, color, item.mine);
      text(ctx, item.mine ? this.board.session : item.session, cx, cy + this.cell * 0.4, {
        size: 9, weight: 800, color: item.mine ? C.teal : C.red, align: 'center', font: MONO,
      });
    }
  }

  drawStrays(ctx) {
    this.board.strays.forEach((stray, i) => {
      const cx = this.gx + (stray.x + 0.5) * this.cell;
      const cy = this.gy + (stray.y + 0.5) * this.cell;
      const color = [C.red, C.purple, C.orange][i % 3];
      drawGhost(ctx, cx, cy - 4, this.cell * 0.58, color, this.t + i);
      // Above the glyph: a stray standing on a resource must not steal its label.
      text(ctx, stray.session, cx, cy - this.cell * 0.34, {
        size: 9, weight: 800, color, align: 'center', font: MONO,
      });
    });
  }

  drawReaper(ctx) {
    const { reaper } = this.board;
    const cx = this.gx + (reaper.x + 0.5) * this.cell;
    const cy = this.gy + (reaper.y + 0.5) * this.cell;
    const r = this.cell * 0.36;
    const facing = reaper.dir ? Math.atan2(reaper.dir.dy, reaper.dir.dx) : 0;
    const gap = (0.08 + 0.14 * Math.abs(Math.sin(this.t * 9))) * Math.PI;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, facing + gap, facing - gap);
    ctx.closePath();
    ctx.fillStyle = C.amber;
    ctx.fill();
    ctx.strokeStyle = C.navyDeep;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - Math.sin(facing) * r * 0.35, cy + Math.cos(facing) * r * -0.35, 2, 0, Math.PI * 2);
    ctx.fillStyle = C.navyDeep;
    ctx.fill();
    ctx.restore();
  }

  drawStrip(ctx) {
    panel(ctx, STRIP.x, STRIP.y, STRIP.w, STRIP.h, { fill: 'rgba(8,26,46,.95)', radius: 12 });
    text(ctx, this.toast.title, STRIP.x + 20, STRIP.y + 24, { size: 15, weight: 800, color: this.toast.tone });
    wrap(this.toast.body, 84).slice(0, 2).forEach((line, i) => {
      text(ctx, line, STRIP.x + 20, STRIP.y + 44 + i * 15, { size: 12, weight: 500, color: C.cream });
    });

    const right = STRIP.x + STRIP.w - 20;
    const left = Math.max(0, this.board.left);
    const tone = left < 8 ? C.red : (left < 16 ? C.amber : C.teal);
    text(ctx, `${left.toFixed(1)}s on the host`, right, STRIP.y + 26, {
      size: 14, weight: 800, color: tone, align: 'right',
    });
    meter(ctx, right - 190, STRIP.y + 36, 190, 8, left / this.spec.seconds, { color: tone });
    text(ctx, 'arrows steer · tap the host to turn', right, STRIP.y + 62, {
      size: 10, weight: 700, color: C.slate, align: 'right', font: MONO,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Glyphs                                                              */
/* ------------------------------------------------------------------ */

/** The three things Testcontainers leaves behind, drawn small enough to litter. */
function drawSpoil(ctx, kind, cx, cy, size, color, mine) {
  const s = size;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = mine ? C.cream : 'rgba(247,249,253,.45)';
  ctx.fillStyle = color;
  ctx.globalAlpha = mine ? 1 : 0.55;

  if (kind === 'container') {
    roundRect(ctx, cx - s / 2, cy - s * 0.34, s, s * 0.68, 3);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(8,26,46,.5)';
    for (const off of [-0.18, 0.18]) {
      ctx.moveTo(cx + s * off, cy - s * 0.26);
      ctx.lineTo(cx + s * off, cy + s * 0.26);
    }
    ctx.stroke();
  } else if (kind === 'network') {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * s * 0.36, cy + Math.sin(a) * s * 0.36, s * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    ctx.ellipse(cx, cy - s * 0.24, s * 0.34, s * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - s * 0.34, cy - s * 0.24, s * 0.68, s * 0.48);
    ctx.beginPath();
    ctx.ellipse(cx, cy + s * 0.24, s * 0.34, s * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** A build that has not finished yet, still wandering the host. */
function drawGhost(ctx, cx, cy, size, color, t) {
  const r = size * 0.42;
  const bob = Math.sin(t * 4) * 1.5;
  ctx.save();
  ctx.translate(cx, cy + bob);
  ctx.beginPath();
  ctx.arc(0, 0, r, Math.PI, 0);
  ctx.lineTo(r, r * 0.7);
  for (let i = 0; i < 3; i++) {
    const x = r - ((i * 2 + 1) * r) / 3;
    ctx.quadraticCurveTo(x, r * 1.25, x - r / 3, r * 0.7);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = C.navyDeep;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  for (const off of [-r * 0.36, r * 0.36]) {
    ctx.beginPath();
    ctx.arc(off, -r * 0.15, r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = C.cream;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(off, -r * 0.15, r * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = C.navyDeep;
    ctx.fill();
  }
  ctx.restore();
}

function dirOfName(name) {
  return DIRS.find((d) => d.name === name);
}

function wrap(str, width) {
  const lines = [];
  let line = '';
  for (const word of String(str).split(' ')) {
    if ((line + word).length > width) {
      lines.push(line.trim());
      line = '';
    }
    line += `${word} `;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

export { RyukLevel };
