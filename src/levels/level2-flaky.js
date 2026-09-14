/**
 * Level 2 — The flaky detective.
 * A matrix of tests by CI runs, mostly hidden. A broken test is red in every
 * run; a flaky one is red only when the runner did something in particular.
 * Re-running buys you another column of evidence, and costs you points.
 */

import { C, MONO, drawBanner, drawClouds, drawHarbour, drawSea, drawSky, panel, text } from '../draw.js';
import { mulberry32, randomSeed } from '../rng.js';
import { CAUSES, FlakyBoard, L2, RUN_FLAGS } from '../rules.js';
const HORIZON = 220;
const ORDER = ['broken', 'port', 'state', 'wait', 'order'];
const KEYS = { Key1: 0, Key2: 1, Key3: 2, Key4: 3, Key5: 4 };

/** The HUD chips own the top 44px of the canvas, so the board starts below them. */
const GRID = { x: 40, y: 84, w: 880, area: 300, head: 52, row: 32, label: 260, gap: 8, maxCol: 92 };
const TOAST_Y = 392;
const TOAST_H = 56;

class FlakyDetectiveLevel {
  constructor() {
    this.id = 2;
  }

  enter(engine) {
    this.engine = engine;
    this.rng = mulberry32(randomSeed());
    this.round = 0;
    this.lives = L2.LIVES;
    this.score = 0;
    this.solved = 0;
    this.mistakes = 0;
    this.spent = 0;
    this.t = 0;
    this.chips = [];
    this.rowRects = [];
    this.rerunRect = { x: 0, y: 0, w: 0, h: 0 };
    this.startBoard();
    this.pushHud();
    engine.announce('Level 2, the flaky detective. Pick a test, then pick the cause whose run flag matches the runs where it went red. Every cause asks for a second confirmation before it costs you a life.');
  }

  pushHud() {
    this.engine.hud({ level: 'Level 2 · The flaky detective', score: this.score, lives: this.lives });
  }

  startBoard() {
    const spec = L2.BOARDS[this.round];
    this.board = new FlakyBoard({ rng: this.rng, ...spec });
    this.cursor = 0;
    this.phase = 'play';
    this.flash = null;
    this.armed = null;
    this.toast = {
      tone: C.teal,
      title: `${this.board.faults} of these ${this.board.rows.length} tests are faulty.`,
      body: 'Pick a test, then pick a cause: the grid will light the runs that cause needs. '
        + 'When the lit columns match the red cells, you have it.',
    };
  }

  update(dt) {
    this.t += dt;
    if (this.flash) {
      this.flash.life -= dt;
      if (this.flash.life <= 0) this.flash = null;
    }

    for (const code of this.engine.input.takePresses()) this.onKey(code);
    for (const tap of this.engine.input.takeTaps()) this.onTap(tap);

    if (this.phase === 'cleared') {
      this.clearTimer -= dt;
      if (this.clearTimer <= 0) this.nextBoard();
    }
  }

  onKey(code) {
    if (this.phase !== 'play') return;
    if (code === 'ArrowUp') return this.move(-1);
    if (code === 'ArrowDown') return this.move(1);
    if (code === 'KeyR') return this.rerun();
    if (code in KEYS) this.pick(ORDER[KEYS[code]]);
  }

  onTap(tap) {
    if (this.phase !== 'play') return;
    if (inside(tap, this.rerunRect)) return this.rerun();
    const row = this.rowRects.find((r) => inside(tap, r));
    if (row) return this.select(row.index);
    const chip = this.chips.find((r) => inside(tap, r));
    if (chip) this.pick(chip.cause);
  }

  move(step) {
    const rows = this.board.rows;
    for (let i = 1; i <= rows.length; i++) {
      const next = (this.cursor + step * i + rows.length * 2) % rows.length;
      if (!rows[next].solved) {
        this.select(next);
        return;
      }
    }
  }

  /** Move the spotlight to a test. Changing suspects cancels a pending call. */
  select(index) {
    this.cursor = index;
    this.armed = null;
    this.engine.sfx('pick');
    const row = this.board.rows[index];
    this.toast = {
      tone: C.teal,
      title: row.name,
      body: 'Read its row: which of P, S, L, O was on in every run where it went red? '
        + 'Pick that cause below.',
    };
    this.engine.announce(`${row.name} selected. ${this.toast.body}`);
  }

  /**
   * Causes arm on the first press and fire on the second. A wrong call costs a
   * life, so the level should never lose one to a stray thumb — and the pause
   * is where the tell gets read.
   */
  pick(cause) {
    if (!CAUSES[cause]) return;
    const row = this.board.rows[this.cursor];
    if (!row || row.solved) return;
    if (this.armed === cause) {
      this.armed = null;
      return this.accuse(cause);
    }
    this.armed = cause;
    this.engine.sfx('pick');
    this.toast = {
      tone: C.amber,
      title: `${CAUSES[cause].name} — ${CAUSES[cause].tell.toLowerCase()}`,
      body: `The lit runs above are the ones it needs. Do they line up with the reds in ${row.name}? `
        + 'Confirm again to accuse; pick another cause to back out.',
    };
    this.engine.announce(`${this.toast.title} ${this.toast.body}`);
  }

  rerun() {
    const result = this.board.rerun();
    if (!result.ok) {
      // Out of re-runs means every column is already on the board, so say that
      // instead of implying the evidence is short: this used to read like a dead
      // end at the exact moment the puzzle became fully decidable.
      const full = this.board.revealed >= this.board.runs.length;
      this.toast = {
        tone: C.amber,
        title: full ? 'That is every run there is.' : 'No CI minutes left.',
        body: full
          ? `All ${this.board.runs.length} runs are on the board. Nothing is hidden — the pattern is in front of you.`
          : 'Call it with the evidence you have. That is the job.',
      };
      this.engine.sfx('pick');
      this.engine.announce(`${this.toast.title} ${this.toast.body}`);
      return;
    }
    this.spent += 1;
    this.armed = null;
    this.engine.sfx('spin');
    const on = RUN_FLAGS.filter((f) => result.run.flags[f.key]).map((f) => f.label);
    this.toast = {
      tone: C.teal,
      title: `Run ${result.run.id} finished.`,
      body: on.length ? `This one ran with ${list(on)}.` : 'This one ran clean: one fork, fresh databases, idle runner, declared order.',
    };
    this.engine.announce(`${this.toast.title} ${this.toast.body}`);
  }

  accuse(cause) {
    const row = this.board.rows[this.cursor];
    if (!row || row.solved) return;
    this.armed = null;
    const result = this.board.accuse(row.id, cause);
    if (!result.ok) return;

    if (result.correct) {
      this.score += result.points;
      this.solved += 1;
      this.flash = { row: row.id, tone: C.green, life: 0.6 };
      this.toast = { tone: C.green, title: `${CAUSES[cause].name}. +${result.points}`, body: CAUSES[cause].fix };
      this.engine.sfx('pass');
      if (this.board.done) return this.clearBoard();
      const verdict = this.toast;
      this.move(1);
      this.toast = verdict;
    } else {
      this.lives -= 1;
      this.mistakes += 1;
      this.flash = { row: row.id, tone: C.red, life: 0.6 };
      this.toast = {
        tone: C.red,
        title: `Not ${CAUSES[cause].name.toLowerCase()}.`,
        body: `${CAUSES[cause].tell} Read that column again.`,
      };
      this.engine.sfx('fail');
      if (this.lives <= 0) return this.finish(false);
    }
    this.engine.announce(`${this.toast.title} ${this.toast.body}`);
    this.pushHud();
  }

  clearBoard() {
    const bonus = this.board.bonus();
    this.score += bonus;
    this.phase = 'cleared';
    this.clearTimer = 2.6;
    this.toast = {
      tone: C.green,
      title: `Board clear · +${bonus} for ${this.board.rerunsLeft} unused re-runs`,
      body: 'Evidence is not free. The fewer runs it takes you, the cheaper the suite.',
    };
    this.engine.sfx('pass');
    this.engine.announce(this.toast.title);
    this.pushHud();
  }

  nextBoard() {
    this.round += 1;
    if (this.round >= L2.ROUNDS) return this.finish(true);
    this.startBoard();
  }

  finish(won) {
    this.engine.hooks.onLevelEnd({
      levelId: 2,
      won,
      score: this.score,
      stats: [
        { label: 'Causes named', value: String(this.solved) },
        { label: 'Wrong calls', value: String(this.mistakes) },
        { label: 'Re-runs spent', value: String(this.spent) },
      ],
      takeaway: won
        ? 'A flaky test is not random: it fails when something about the run changes. Find that something and the fix writes itself — usually a wait strategy or a container that was shared when it should not have been.'
        : 'Re-running until it goes green is not debugging. The pattern across runs is the evidence: what did the red runs have in common?',
    });
  }

  /* ---------------------------------------------------------------- */

  draw(ctx) {
    const W = 960;
    const H = 540;
    drawSky(ctx, W, H, HORIZON);
    drawClouds(ctx, this.t * 0.6, W, HORIZON);
    drawHarbour(ctx, W, HORIZON);
    drawSea(ctx, this.t, W, H, HORIZON);

    this.drawHeader(ctx);
    this.drawMatrix(ctx);
    this.drawToast(ctx);
    this.drawCauses(ctx);

    if (this.phase === 'cleared') {
      drawBanner(ctx, W, 190, 'Board clear', `${this.board.rerunsLeft} re-runs unspent`, C.green);
    }
  }

  drawHeader(ctx) {
    text(ctx, `BOARD ${this.round + 1} / ${L2.ROUNDS}`, 40, 68, {
      size: 13, weight: 700, color: C.navy, letterSpacing: '2px',
    });
    text(ctx, `${this.board.remaining} left to name`, 214, 68, {
      size: 13, weight: 600, color: C.navy, alpha: 0.7,
    });

    const w = 210;
    const x = 920 - w;
    const can = this.board.canRerun();
    this.rerunRect = { x, y: 48, w, h: 30 };
    panel(ctx, x, 48, w, 30, {
      fill: can ? C.teal : 'rgba(54,30,91,.35)', stroke: 'transparent', radius: 8,
    });
    text(ctx, `RE-RUN (R) · ${this.board.rerunsLeft} left`, x + w / 2, 68, {
      size: 12, weight: 800, color: can ? C.navyDeep : 'rgba(247,249,253,.55)', align: 'center',
    });
  }

  drawMatrix(ctx) {
    const rows = this.board.rows;
    const h = GRID.head + rows.length * GRID.row + 26;
    const top = GRID.y + Math.round((GRID.area - h) / 2);
    // The run columns share out whatever room the test names leave them.
    const left = GRID.x + 20 + GRID.label;
    const room = GRID.x + GRID.w - 20 - left;
    const n = this.board.runs.length;
    this.col = Math.min(GRID.maxCol, Math.floor((room + GRID.gap) / n) - GRID.gap);
    this.colStart = left + Math.max(0, Math.round((room - (n * (this.col + GRID.gap) - GRID.gap)) / 2));
    panel(ctx, GRID.x, top, GRID.w, h, { fill: 'rgba(41,26,63,.95)', radius: 12 });
    this.drawArmedColumns(ctx, top, h);

    this.board.runs.forEach((run, i) => {
      const cx = this.colX(i) + this.col / 2;
      const seen = i < this.board.revealed;
      text(ctx, `#${run.id}`, cx, top + 22, {
        size: 11, weight: 700, color: seen ? C.cream : 'rgba(247,249,253,.3)', align: 'center', font: MONO,
      });
      RUN_FLAGS.forEach((flag, f) => {
        const on = seen && run.flags[flag.key];
        const bx = cx - 24 + f * 13;
        panel(ctx, bx, top + 28, 11, 14, {
          fill: on ? C.amber : 'rgba(255,255,255,.08)', stroke: 'transparent', radius: 3,
        });
        text(ctx, flag.short, bx + 5.5, top + 35, {
          size: 8, weight: 800, align: 'center', baseline: 'middle', font: MONO,
          color: on ? C.navyDeep : 'rgba(247,249,253,.35)',
        });
      });
    });

    this.rowRects = rows.map((row, r) => {
      const y = top + GRID.head + r * GRID.row;
      const selected = r === this.cursor && this.phase === 'play';
      if (selected) {
        panel(ctx, GRID.x + 8, y + 2, GRID.w - 16, GRID.row - 4, {
          fill: 'rgba(22,214,199,.16)', stroke: C.teal, radius: 8,
        });
        panel(ctx, GRID.x + 8, y + 2, 4, GRID.row - 4, {
          fill: C.teal, stroke: 'transparent', radius: 2,
        });
      }
      if (this.flash && this.flash.row === row.id) {
        panel(ctx, GRID.x + 8, y + 2, GRID.w - 16, GRID.row - 4, {
          fill: this.flash.tone, stroke: 'transparent', radius: 8, alpha: 0.25,
        });
      }
      text(ctx, truncate(row.name, row.solved ? 20 : 34), GRID.x + 20, y + GRID.row / 2, {
        size: 11.5, weight: row.solved ? 400 : 600, font: MONO, baseline: 'middle',
        color: row.solved ? 'rgba(247,249,253,.45)' : C.cream,
      });
      if (row.solved) {
        text(ctx, CAUSES[row.cause].name.toLowerCase(), GRID.x + 12 + GRID.label, y + GRID.row / 2, {
          size: 9.5, weight: 700, color: C.green, align: 'right', baseline: 'middle',
        });
      }

      this.board.runs.forEach((run, i) => {
        const seen = i < this.board.revealed;
        const red = seen && isRedCell(row, run);
        const cw = Math.min(this.col - 10, 58);
        const cx = this.colX(i) + (this.col - cw) / 2;
        const cy = y + 6;
        panel(ctx, cx, cy, cw, GRID.row - 12, {
          fill: !seen ? 'rgba(255,255,255,.05)' : red ? 'rgba(224,82,99,.92)' : 'rgba(59,178,115,.92)',
          stroke: 'transparent', radius: 5,
        });
        if (!seen) {
          text(ctx, '?', cx + cw / 2, cy + (GRID.row - 12) / 2, {
            size: 11, weight: 700, color: 'rgba(247,249,253,.3)', align: 'center', baseline: 'middle',
          });
        }
      });
      return { index: r, x: GRID.x + 8, y, w: GRID.w - 16, h: GRID.row };
    });

    const legend = `LIT BADGE = THAT RUN HAD IT ON   ·   `
      + RUN_FLAGS.map((f) => `${f.short} ${f.label}`).join('   ·   ');
    text(ctx, legend, GRID.x + 20, top + h - 12, {
      size: 10, weight: 600, color: 'rgba(247,249,253,.5)', font: MONO,
    });
  }

  /**
   * While a cause is armed, light the runs it needs and veil the ones it does
   * not. That turns the whole deduction into a shape comparison — the lit
   * columns should line up with the reds in the row you suspect — instead of
   * asking the player to hold four flag patterns in their head.
   */
  drawArmedColumns(ctx, top, h) {
    if (!this.armed || !CAUSES[this.armed]) return;
    const { flag } = CAUSES[this.armed];
    const y = top + 14;
    const height = h - 34;
    this.board.runs.forEach((run, i) => {
      if (i >= this.board.revealed) return;
      const needed = flag === null || run.flags[flag];
      panel(ctx, this.colX(i) - 3, y, this.col + 6, height, {
        fill: needed ? 'rgba(244,185,66,.14)' : 'rgba(4,14,26,.55)',
        stroke: needed ? 'rgba(244,185,66,.55)' : 'transparent',
        radius: 7,
      });
    });
  }

  drawToast(ctx) {
    const y = TOAST_Y;
    panel(ctx, GRID.x, y, GRID.w, TOAST_H, { fill: 'rgba(41,26,63,.88)', radius: 10 });
    text(ctx, this.toast.title, GRID.x + 18, y + 17, { size: 13.5, weight: 800, color: this.toast.tone });
    wrap(this.toast.body, 100).slice(0, 2).forEach((line, i) => {
      text(ctx, line, GRID.x + 18, y + 34 + i * 15, {
        size: 12, weight: 400, color: 'rgba(247,249,253,.8)',
      });
    });
  }

  /**
   * The five causes, each showing the run flag that triggers it in the same
   * badge the column headers use. That pairing is the whole puzzle: match the
   * letter on the card to the letter lit above the red cells.
   */
  drawCauses(ctx) {
    const y = 458;
    const w = 168;
    this.chips = ORDER.map((key, i) => {
      const cause = CAUSES[key];
      const x = 40 + i * (w + 10);
      const armed = this.armed === key;
      panel(ctx, x, y, w, 76, {
        fill: armed ? 'rgba(244,185,66,.22)' : 'rgba(41,26,63,.72)',
        stroke: armed ? C.amber : 'rgba(255,255,255,.22)',
        radius: 9,
      });
      panel(ctx, x + 10, y + 9, 18, 18, { fill: armed ? C.amber : C.teal, stroke: 'transparent', radius: 5 });
      text(ctx, String(i + 1), x + 19, y + 19, {
        size: 11, weight: 800, color: C.navyDeep, align: 'center', baseline: 'middle',
      });
      text(ctx, cause.name, x + 34, y + 19, {
        size: 12, weight: 700, color: C.cream, baseline: 'middle',
      });

      const flag = RUN_FLAGS.find((f) => f.key === cause.flag);
      text(ctx, flag ? 'RED WHEN THIS IS LIT' : 'RED IN EVERY RUN', x + 11, y + 40, {
        size: 8, weight: 800, color: 'rgba(247,249,253,.45)', letterSpacing: '1.2px',
      });
      panel(ctx, x + 11, y + 46, flag ? 16 : 22, 18, {
        fill: flag ? C.amber : C.red, stroke: 'transparent', radius: 4,
      });
      text(ctx, flag ? flag.short : 'ALL', x + (flag ? 19 : 22), y + 55, {
        size: flag ? 10 : 9, weight: 800, color: C.navyDeep,
        align: 'center', baseline: 'middle', font: MONO,
      });
      text(ctx, flag ? flag.label : 'no pattern to find', x + (flag ? 33 : 39), y + 55, {
        size: 10, weight: 600, color: 'rgba(247,249,253,.78)', baseline: 'middle',
      });

      if (armed) {
        text(ctx, 'CONFIRM TO ACCUSE', x + w / 2, y + 71, {
          size: 8, weight: 800, color: C.amber, align: 'center', letterSpacing: '1px',
        });
      }
      return { cause: key, x, y, w, h: 76 };
    });
  }

  colX(i) {
    return this.colStart + i * (this.col + GRID.gap);
  }
}

function isRedCell(row, run) {
  if (!row.cause) return false;
  const flag = CAUSES[row.cause].flag;
  return flag === null ? true : run.flags[flag];
}

function list(items) {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

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

export { FlakyDetectiveLevel };
