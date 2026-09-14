/**
 * Level 3 — Pipe Dream. The test lives on the host, the container lives on a
 * Docker network, and a wall runs between them. Rotate the pieces into a route
 * before the connection pool opens; the wall only ever opens on a published
 * port, which is the whole point of the level.
 */

import { C, MONO, SERVICES, drawBanner, drawClouds, drawContainer, drawHarbour, drawSea, drawSky, meter, panel, roundRect, text, } from '../draw.js';
import { mulberry32, randomSeed } from '../rng.js';
import { DIRS, L3, buildPipeGrid, opens } from '../rules.js';
const HORIZON = 220;
/** The HUD chips own the top 44px of the canvas, so everything starts below. */
const AREA = { x: 250, y: 100, w: 510, h: 316 };
const STRIP = { x: 40, y: 430, w: 880, h: 78 };
const MAX_CELL = 78;

const MOVES = {
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
};

class PipeDreamLevel {
  constructor() {
    this.id = 3;
  }

  enter(engine) {
    this.engine = engine;
    this.rng = mulberry32(randomSeed());
    this.t = 0;
    this.round = 0;
    this.lives = L3.LIVES;
    this.score = 0;
    this.connections = 0;
    this.dryTotal = 0;
    this.startBoard();
    this.pushHud();
  }

  pushHud() {
    this.engine.hud({ level: 'Level 3 · Pipe Dream', score: this.score, lives: this.lives });
  }

  startBoard() {
    this.spec = L3.BOARDS[this.round];
    this.grid = buildPipeGrid(this.spec, this.rng);
    this.service = SERVICES[this.spec.service];
    this.mapped = 32768 + Math.floor(this.rng() * 900);
    this.cursor = { x: 0, y: this.spec.srcRow };
    this.phase = 'lead';
    this.lead = this.spec.lead;
    this.fillT = 0;
    this.timer = 0;
    this.fresh = [];
    this.layout();
    this.toast = {
      tone: C.teal,
      title: `${this.service.label} is listening on ${this.spec.port}, inside the network.`,
      body: `Your test is outside it. Turn the pipes into a route — the wall only opens where the port is published.`,
    };
    this.engine.announce(`Board ${this.round + 1}. ${this.toast.title} ${this.toast.body}`);
  }

  /** Cell size and grid origin, recomputed per board so every board is centred. */
  layout() {
    const { cols, rows } = this.spec;
    this.cell = Math.min(Math.floor(AREA.w / cols), Math.floor(AREA.h / rows), MAX_CELL);
    this.gx = AREA.x + Math.round((AREA.w - cols * this.cell) / 2);
    this.gy = AREA.y + Math.round((AREA.h - rows * this.cell) / 2);
  }

  update(dt) {
    this.t += dt;
    for (const code of this.engine.input.takePresses()) this.onKey(code);
    for (const tap of this.engine.input.takeTaps()) this.onTap(tap);

    if (this.phase === 'lead') {
      this.lead -= dt;
      if (this.lead <= 0) this.beginFlow();
      return;
    }
    if (this.phase === 'flow') {
      this.fillT += dt;
      while (this.phase === 'flow' && this.fillT >= L3.FILL_TIME) {
        this.fillT -= L3.FILL_TIME;
        this.tick();
      }
      return;
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    if (this.phase === 'won') this.nextBoard();
    else if (this.lives <= 0) this.finish(false);
    else this.startBoard();
  }

  /* ---------------------------------------------------------------- */
  /* Input                                                             */
  /* ---------------------------------------------------------------- */

  onKey(code) {
    if (this.phase !== 'lead' && this.phase !== 'flow') return;
    const move = MOVES[code];
    if (move) {
      this.cursor.x = clampTo(this.cursor.x + move.dx, this.spec.cols);
      this.cursor.y = clampTo(this.cursor.y + move.dy, this.spec.rows);
      this.engine.sfx('pick');
      return;
    }
    if (code === 'Space' || code === 'Enter' || code === 'KeyX') this.turn(this.cursor.x, this.cursor.y);
  }

  onTap(tap) {
    if (this.phase !== 'lead' && this.phase !== 'flow') return;
    const x = Math.floor((tap.x - this.gx) / this.cell);
    const y = Math.floor((tap.y - this.gy) / this.cell);
    if (!this.grid.inside(x, y)) return;
    this.cursor = { x, y };
    this.turn(x, y);
  }

  turn(x, y) {
    if (this.grid.rotateAt(x, y)) {
      this.engine.sfx('spin');
      return;
    }
    this.engine.sfx('fail');
    this.toast = {
      tone: C.amber,
      title: 'That pipe is already wet.',
      body: 'Once the connection is flowing through a piece, it is not yours to turn any more. Work ahead of the water.',
    };
    this.engine.announce(this.toast.title);
  }

  /* ---------------------------------------------------------------- */
  /* The water                                                         */
  /* ---------------------------------------------------------------- */

  beginFlow() {
    this.phase = 'flow';
    this.fillT = 0;
    this.engine.sfx('spin');
    if (!this.grid.start()) {
      this.fail('Connection refused.', 'The first pipe never opened towards the test, so nothing ever left the host.');
      return;
    }
    this.fresh = [{ x: 0, y: this.spec.srcRow }];
    this.toast = {
      tone: C.sea,
      title: 'The pool is opening connections.',
      body: 'Wet pipe is frozen. Keep turning the dry pieces in front of it.',
    };
    this.engine.announce('The connection is flowing.');
    if (this.grid.connected) this.win();
  }

  tick() {
    this.fresh = this.grid.advance();
    if (this.grid.connected) {
      this.win();
      return;
    }
    if (this.grid.dead) {
      this.fail('Connection refused.', 'The water ran into a closed pipe. On the host that reads as a timeout and a very confused developer.');
      return;
    }
    if (!this.grid.canStillWin()) {
      this.fail('No way through.', 'The water froze a piece you still needed. There is no route left to turn.');
      return;
    }
    const gate = this.fresh.find((p) => p.x === this.spec.wallX && this.grid.isGate(p.y));
    if (gate) {
      this.toast = {
        tone: C.teal,
        title: `Through the published port · ${this.spec.port} → localhost:${this.mapped}`,
        body: 'That crossing is the only hole in the wall, and Docker chose which host port it lands on.',
      };
      this.engine.sfx('pick');
    }
  }

  win() {
    const bonus = this.grid.dry * L3.POINTS_PER_DRY;
    this.score += L3.POINTS_CONNECT + bonus;
    this.connections += 1;
    this.dryTotal += this.grid.dry;
    this.phase = 'won';
    this.timer = 2.8;
    this.pushHud();
    this.engine.sfx('pass');
    this.toast = {
      tone: C.green,
      title: `Connected · +${L3.POINTS_CONNECT} and +${bonus} for ${this.grid.dry} dry pieces`,
      body: `The test talks to ${this.service.label} on localhost:${this.mapped}, and the container never knew it was mapped.`,
    };
    this.engine.announce(this.toast.title);
  }

  fail(title, body) {
    this.lives -= 1;
    this.phase = 'lost';
    this.timer = 2.6;
    this.pushHud();
    this.engine.sfx('fail');
    this.toast = { tone: C.red, title, body };
    this.engine.announce(`${title} ${body}`);
  }

  nextBoard() {
    this.round += 1;
    if (this.round >= L3.ROUNDS) return this.finish(true);
    this.startBoard();
  }

  finish(won) {
    this.engine.hooks.onLevelEnd({
      levelId: 3,
      won,
      score: this.score,
      stats: [
        { label: 'Ports crossed', value: `${this.connections}/${L3.ROUNDS}` },
        { label: 'Dry pipe left', value: this.dryTotal },
        { label: 'Lives left', value: Math.max(0, this.lives) },
      ],
      takeaway: 'Nothing on the host can reach a port that was never published, and the host port is not the one in your config: ask the container for getMappedPort().',
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

    this.drawHeader(ctx);
    this.drawHost(ctx);
    this.drawBoard(ctx);
    this.drawWall(ctx);
    this.drawTarget(ctx);
    this.drawStrip(ctx);

    if (this.phase === 'won') {
      drawBanner(ctx, 960, 186, 'Connected', `localhost:${this.mapped} → ${this.service.label}:${this.spec.port}`, C.green);
    } else if (this.phase === 'lost') {
      drawBanner(ctx, 960, 186, this.toast.title, this.lives > 0 ? 'One life gone. The board is re-plumbed.' : 'No lives left.', C.red);
    }
  }

  drawHeader(ctx) {
    text(ctx, `BOARD ${this.round + 1} / ${L3.ROUNDS}`, 40, 68, { size: 13, weight: 800, color: C.navy, font: MONO });
  }

  /** The clock, parked inside the strip where the HUD chips cannot cover it. */
  drawClock(ctx) {
    const waiting = this.phase === 'lead';
    const right = STRIP.x + STRIP.w - 20;
    const tone = !waiting ? C.sea : (this.lead < 3 ? C.red : (this.lead < 6 ? C.amber : C.teal));
    const label = waiting
      ? `pool opens in ${Math.max(0, this.lead).toFixed(1)}s`
      : 'the connection is flowing';
    text(ctx, label, right, STRIP.y + 26, {
      size: 14, weight: 800, color: tone, align: 'right',
    });
    const value = waiting ? this.lead / this.spec.lead : 1;
    meter(ctx, right - 190, STRIP.y + 36, 190, 8, value, { color: tone });
    text(ctx, 'arrows move · space or click turns a piece', right, STRIP.y + 62, {
      size: 10, weight: 700, color: C.slate, align: 'right', font: MONO,
    });
  }

  /** The test bench on the host side, wired into the first cell. */
  drawHost(ctx) {
    const y = this.gy + this.spec.srcRow * this.cell + this.cell / 2;
    panel(ctx, 40, 120, 196, 104, { fill: 'rgba(8,26,46,.92)', radius: 12 });
    text(ctx, 'YOUR TEST · THE HOST', 56, 142, { size: 11, weight: 800, color: C.slate, font: MONO });
    text(ctx, '@Test void queries()', 56, 164, { size: 12, weight: 600, color: C.cream, font: MONO });
    text(ctx, `db.getMappedPort(${this.spec.port})`, 56, 184, { size: 12, weight: 600, color: C.cream, font: MONO });
    text(ctx, `→ localhost:${this.mapped}`, 56, 204, { size: 12, weight: 700, color: C.teal, font: MONO });

    const wet = this.grid.isFilled(0, this.spec.srcRow);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 14;
    ctx.strokeStyle = C.navyDeep;
    ctx.beginPath();
    ctx.moveTo(236, y);
    ctx.lineTo(this.gx + 4, y);
    ctx.stroke();
    ctx.lineWidth = 8;
    ctx.strokeStyle = wet ? C.sea : 'rgba(247,241,227,.7)';
    ctx.beginPath();
    ctx.moveTo(236, y);
    ctx.lineTo(this.gx + 4, y);
    ctx.stroke();
    ctx.restore();
  }

  drawBoard(ctx) {
    const { cols, rows } = this.spec;
    panel(ctx, this.gx - 8, this.gy - 8, cols * this.cell + 16, rows * this.cell + 16, {
      fill: 'rgba(8,26,46,.86)', radius: 14,
    });
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) this.drawCell(ctx, x, y);
    }
    const cur = this.cursor;
    const px = this.gx + cur.x * this.cell;
    const py = this.gy + cur.y * this.cell;
    const live = this.phase === 'lead' || this.phase === 'flow';
    roundRect(ctx, px + 2, py + 2, this.cell - 4, this.cell - 4, 8);
    ctx.strokeStyle = this.grid.isFilled(cur.x, cur.y) ? C.slate : (live ? C.amber : C.slate);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawCell(ctx, x, y) {
    const size = this.cell;
    const px = this.gx + x * size;
    const py = this.gy + y * size;
    const cx = px + size / 2;
    const cy = py + size / 2;
    const cell = this.grid.at(x, y);
    const wet = this.grid.isFilled(x, y);
    const fresh = this.fresh.some((p) => p.x === x && p.y === y);

    roundRect(ctx, px + 2, py + 2, size - 4, size - 4, 8);
    ctx.fillStyle = wet ? 'rgba(42,156,201,.16)' : 'rgba(255,255,255,.05)';
    ctx.fill();

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(10, size * 0.3);
    ctx.strokeStyle = C.ink;
    strokeArms(ctx, cell.mask, cx, cy, size);
    ctx.lineWidth = Math.max(5, size * 0.17);
    ctx.strokeStyle = wet ? C.sea : 'rgba(247,241,227,.8)';
    if (fresh && this.phase === 'flow') {
      ctx.globalAlpha = 0.5 + 0.5 * Math.min(1, this.fillT / L3.FILL_TIME);
    }
    strokeArms(ctx, cell.mask, cx, cy, size);
    ctx.restore();
  }

  /** The wall, with a teal opening on every published port. */
  drawWall(ctx) {
    const { rows, wallX } = this.spec;
    const wx = this.gx + wallX * this.cell;
    const top = this.gy;
    const bottom = this.gy + rows * this.cell;

    text(ctx, 'host', this.gx, this.gy - 18, { size: 11, weight: 800, color: C.navy, font: MONO });
    text(ctx, 'docker network', this.gx + this.spec.cols * this.cell, this.gy - 18, {
      size: 11, weight: 800, color: C.navy, align: 'right', font: MONO,
    });
    const chip = `published :${this.spec.port}`;
    const chipW = chip.length * 6.6 + 18;
    panel(ctx, wx - chipW / 2, this.gy - 30, chipW, 18, { fill: 'rgba(46,196,182,.9)', stroke: 'rgba(8,26,46,.4)', radius: 9 });
    text(ctx, chip, wx, this.gy - 20, {
      size: 10, weight: 800, color: C.navyDeep, align: 'center', baseline: 'middle', font: MONO,
    });

    for (let y = 0; y < rows; y++) {
      const y0 = top + y * this.cell;
      if (this.grid.isGate(y)) {
        roundRect(ctx, wx - 4, y0 + 6, 8, this.cell - 12, 4);
        ctx.fillStyle = 'rgba(46,196,182,.25)';
        ctx.fill();
        ctx.strokeStyle = C.teal;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        continue;
      }
      ctx.fillStyle = 'rgba(18,38,58,.96)';
      ctx.fillRect(wx - 5, y0, 10, this.cell);
      ctx.save();
      ctx.beginPath();
      ctx.rect(wx - 5, y0, 10, this.cell);
      ctx.clip();
      ctx.strokeStyle = 'rgba(125,149,171,.5)';
      ctx.lineWidth = 2;
      for (let h = y0 - 10; h < y0 + this.cell + 10; h += 8) {
        ctx.beginPath();
        ctx.moveTo(wx - 6, h);
        ctx.lineTo(wx + 6, h - 10);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(125,149,171,.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(wx, top - 6);
    ctx.lineTo(wx, bottom + 6);
    ctx.stroke();
  }

  /** The container waiting on the far side. */
  drawTarget(ctx) {
    const { cols, dstRow } = this.spec;
    const y = this.gy + dstRow * this.cell + this.cell / 2;
    const x = this.gx + cols * this.cell + 26;
    const wet = this.grid.isFilled(cols - 1, dstRow) && opens(this.grid.at(cols - 1, dstRow).mask, 2);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 14;
    ctx.strokeStyle = C.navyDeep;
    ctx.beginPath();
    ctx.moveTo(x - 30, y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.lineWidth = 8;
    ctx.strokeStyle = wet ? C.sea : 'rgba(247,241,227,.7)';
    ctx.beginPath();
    ctx.moveTo(x - 30, y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.restore();

    drawContainer(ctx, x, y - 32, 92, 64, this.service.color, { label: this.service.label });
    text(ctx, `:${this.spec.port}`, x + 46, y + 48, {
      size: 12, weight: 700, color: C.cream, align: 'center', font: MONO,
    });
  }

  drawStrip(ctx) {
    panel(ctx, STRIP.x, STRIP.y, STRIP.w, STRIP.h, { fill: 'rgba(8,26,46,.95)', radius: 12 });
    text(ctx, this.toast.title, STRIP.x + 20, STRIP.y + 24, { size: 15, weight: 800, color: this.toast.tone });
    const lines = wrap(this.toast.body, 88).slice(0, 2);
    lines.forEach((line, i) => {
      text(ctx, line, STRIP.x + 20, STRIP.y + 44 + i * 15, { size: 12, weight: 500, color: C.cream });
    });
    this.drawClock(ctx);
  }
}

/** Stroke one arm from the middle of the cell to every open side. */
function strokeArms(ctx, mask, cx, cy, size) {
  const reach = size / 2 - 1;
  for (const dir of DIRS) {
    if (!opens(mask, dir.bit)) continue;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + dir.dx * reach, cy + dir.dy * reach);
    ctx.stroke();
  }
}

function clampTo(value, size) {
  return Math.max(0, Math.min(size - 1, value));
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

export { PipeDreamLevel };
