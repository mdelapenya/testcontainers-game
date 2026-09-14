/** Shared canvas art: palette, primitives and the cast (containers, whale, gull). */

const C = {
  // Official site colors, mapped to the existing scenery roles (docs/branding.md).
  navy:      '#361e5b', // plum
  navyDeep:  '#291a3f', // eggplant
  cream:     '#f7f9fd', // ghost
  sky1:      '#d1ebff', // tc-blue-200
  sky2:      '#edf7ff', // tc-blue-100
  sea:       '#17a6b2', // pacific
  seaDeep:   '#027f9e', // teal
  seaDark:   '#027f9e',
  whale:     '#6638f2', // violet
  whaleDark: '#361e5b',
  whaleLite: '#c3c7e6', // fog
  teal:      '#16d6c7', // aqua accent
  green:     '#3bb273',
  orange:    '#e8833a',
  purple:    '#6638f2',
  red:       '#e05263',
  amber:     '#f4b942',
  slate:     '#c3c7e6',
  white:     '#ffffff',
  ink:       '#291a3f',
};

const FONT = '"Rubik", system-ui, -apple-system, Arial, sans-serif';
const MONO = '"Roboto Mono", ui-monospace, Menlo, Consolas, monospace';

/** The cast. The first three carry levels 2 and 3; the rest visit level 1. */
const SERVICES = {
  postgres: { label: 'postgres', short: 'PG', color: C.teal,   port: 5432 },
  redis:    { label: 'redis',    short: 'RD', color: C.orange, port: 6379 },
  kafka:    { label: 'kafka',    short: 'KF', color: C.purple, port: 9092 },
  nginx:    { label: 'nginx',    short: 'NX', color: C.green,  port: 80 },
  keycloak: { label: 'keycloak', short: 'KC', color: C.whale,  port: 8080 },
  mysql:    { label: 'mysql',    short: 'MY', color: C.amber,  port: 3306 },
};

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function text(ctx, str, x, y, opts = {}) {
  const {
    size = 16, weight = 600, color = C.cream, align = 'left',
    baseline = 'alphabetic', font = FONT, alpha = 1, letterSpacing = null,
  } = opts;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (letterSpacing && 'letterSpacing' in ctx) ctx.letterSpacing = letterSpacing;
  ctx.fillText(str, x, y);
  ctx.restore();
}

function panel(ctx, x, y, w, h, opts = {}) {
  const { fill = 'rgba(41,26,63,.72)', stroke = 'rgba(255,255,255,.16)', radius = 12, lineWidth = 1, alpha = 1 } = opts;
  ctx.save();
  ctx.globalAlpha = alpha;
  roundRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  ctx.restore();
}

function meter(ctx, x, y, w, h, value, opts = {}) {
  const { color = C.teal, track = 'rgba(255,255,255,.14)', radius = h / 2, danger = 1.01 } = opts;
  const v = Math.max(0, Math.min(1, value));
  ctx.save();
  roundRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = track;
  ctx.fill();
  if (v > 0) {
    roundRect(ctx, x, y, Math.max(h, w * v), h, radius);
    ctx.fillStyle = v >= danger ? C.red : color;
    ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Scenery                                                             */
/* ------------------------------------------------------------------ */

function drawSky(ctx, w, h, horizon) {
  const g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, C.sky1);
  g.addColorStop(1, C.sky2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, horizon);
}

function drawClouds(ctx, t, w, horizon) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  const clouds = [
    { x: 0.12, y: 0.22, s: 1.0, v: 6 },
    { x: 0.52, y: 0.12, s: 0.7, v: 9 },
    { x: 0.82, y: 0.28, s: 1.2, v: 4 },
  ];
  for (const c of clouds) {
    const x = ((c.x * w + t * c.v) % (w + 200)) - 100;
    const y = c.y * horizon;
    const s = c.s;
    ctx.beginPath();
    ctx.arc(x, y, 22 * s, 0, Math.PI * 2);
    ctx.arc(x + 26 * s, y + 6 * s, 17 * s, 0, Math.PI * 2);
    ctx.arc(x - 24 * s, y + 8 * s, 14 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHarbour(ctx, w, horizon) {
  ctx.save();
  ctx.fillStyle = 'rgba(195,199,230,.45)';
  // crane gantries
  for (const base of [90, 250, 760]) {
    ctx.fillRect(base, horizon - 96, 7, 96);
    ctx.fillRect(base + 46, horizon - 96, 7, 96);
    ctx.fillRect(base - 16, horizon - 104, 104, 9);
    ctx.fillRect(base + 24, horizon - 140, 7, 40);
  }
  // stacked containers on the dock
  const dock = [
    [430, C.purple], [472, C.teal], [514, C.orange], [556, C.whale],
    [451, C.orange], [493, C.purple], [535, C.teal],
  ];
  dock.forEach(([x, color], i) => {
    const row = i < 4 ? 0 : 1;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = color;
    ctx.fillRect(x, horizon - 26 - row * 22, 38, 20);
  });
  ctx.restore();
}

function drawSea(ctx, t, w, h, horizon) {
  const g = ctx.createLinearGradient(0, horizon, 0, h);
  g.addColorStop(0, C.sea);
  g.addColorStop(1, C.seaDark);
  ctx.fillStyle = g;
  ctx.fillRect(0, horizon, w, h - horizon);

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.22)';
  ctx.lineWidth = 2;
  for (let row = 0; row < 4; row++) {
    const y = horizon + 26 + row * 34;
    const speed = 22 + row * 10;
    const amp = 3 + row;
    ctx.beginPath();
    for (let x = -20; x <= w + 20; x += 12) {
      const yy = y + Math.sin((x + t * speed) / 46) * amp;
      if (x === -20) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.globalAlpha = 0.5 - row * 0.08;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A Docker-ish shipping container.
 * state: 'idle' | 'booting' | 'busy' | 'ghost'
 */
function drawContainer(ctx, x, y, w, h, color, opts = {}) {
  const { label = '', state = 'idle', progress = 0, badge = '', shadow = true } = opts;
  ctx.save();
  if (shadow) {
    ctx.shadowColor = 'rgba(0,0,0,.28)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
  }
  if (state === 'ghost') ctx.globalAlpha = 0.35;

  roundRect(ctx, x, y, w, h, 5);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // corrugated ribs
  ctx.save();
  roundRect(ctx, x, y, w, h, 5);
  ctx.clip();
  ctx.strokeStyle = 'rgba(0,0,0,.16)';
  ctx.lineWidth = 2;
  for (let i = x + 8; i < x + w - 4; i += 9) {
    ctx.beginPath();
    ctx.moveTo(i, y + 4);
    ctx.lineTo(i, y + h - 4);
    ctx.stroke();
  }
  // top and bottom rails
  ctx.fillStyle = 'rgba(255,255,255,.22)';
  ctx.fillRect(x, y, w, 4);
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.fillRect(x, y + h - 4, w, 4);

  if (state === 'booting') {
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    ctx.fillRect(x, y + h - 9, w * Math.max(0, Math.min(1, progress)), 5);
  }
  ctx.restore();

  if (label) {
    const plateW = Math.min(w - 12, label.length * 7.2 + 14);
    roundRect(ctx, x + (w - plateW) / 2, y + h / 2 - 10, plateW, 20, 4);
    ctx.fillStyle = 'rgba(41,26,63,.8)';
    ctx.fill();
    text(ctx, label, x + w / 2, y + h / 2 + 1, {
      size: 12, weight: 700, color: C.cream, align: 'center', baseline: 'middle', font: MONO,
    });
  }

  if (badge) {
    text(ctx, badge, x + w / 2, y - 8, { size: 12, weight: 700, color: C.cream, align: 'center' });
  }
  ctx.restore();
}

function drawWhale(ctx, cx, cy, scale, tilt = 0) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  ctx.scale(scale, scale);

  // tail
  ctx.fillStyle = C.whaleDark;
  ctx.beginPath();
  ctx.moveTo(88, 2);
  ctx.quadraticCurveTo(126, -30, 140, -12);
  ctx.quadraticCurveTo(128, 2, 140, 18);
  ctx.quadraticCurveTo(124, 30, 88, 16);
  ctx.closePath();
  ctx.fill();

  // body
  ctx.fillStyle = C.whale;
  ctx.beginPath();
  ctx.moveTo(-118, 6);
  ctx.quadraticCurveTo(-118, -44, -40, -48);
  ctx.quadraticCurveTo(50, -52, 96, -14);
  ctx.quadraticCurveTo(104, 2, 94, 20);
  ctx.quadraticCurveTo(40, 40, -40, 38);
  ctx.quadraticCurveTo(-114, 34, -118, 6);
  ctx.closePath();
  ctx.fill();

  // belly
  ctx.fillStyle = C.whaleLite;
  ctx.beginPath();
  ctx.moveTo(-104, 18);
  ctx.quadraticCurveTo(-30, 44, 70, 22);
  ctx.quadraticCurveTo(20, 36, -40, 36);
  ctx.quadraticCurveTo(-92, 34, -104, 18);
  ctx.closePath();
  ctx.fill();

  // fin
  ctx.fillStyle = C.whaleDark;
  ctx.beginPath();
  ctx.moveTo(6, 20);
  ctx.quadraticCurveTo(24, 44, -18, 36);
  ctx.closePath();
  ctx.fill();

  // eye + smile
  ctx.fillStyle = C.ink;
  ctx.beginPath();
  ctx.arc(-86, 2, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(-92, 8, 16, 0.2, 1.15);
  ctx.stroke();

  ctx.restore();
}

function drawGull(ctx, x, y, t) {
  const flap = Math.sin(t * 3) * 4;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = C.white;
  ctx.beginPath();
  ctx.ellipse(0, 0, 13, 8, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-11, -7, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.slate;
  ctx.beginPath();
  ctx.moveTo(2, -2);
  ctx.quadraticCurveTo(12, -10 - flap, 18, -2);
  ctx.quadraticCurveTo(10, 2, 2, 2);
  ctx.fill();
  ctx.fillStyle = C.amber;
  ctx.beginPath();
  ctx.moveTo(-16, -6);
  ctx.lineTo(-23, -4);
  ctx.lineTo(-16, -2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.ink;
  ctx.beginPath();
  ctx.arc(-12, -8, 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSplash(ctx, x, y, progress) {
  const p = Math.max(0, Math.min(1, progress));
  ctx.save();
  ctx.globalAlpha = 1 - p;
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI - Math.PI;
    const d = 10 + p * 52;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6, 5 * (1 - p) + 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Centred banner used for round results across levels. */
function drawBanner(ctx, w, y, title, subtitle, color) {
  // Grow the plate so a long subtitle never spills over its own background.
  ctx.save();
  ctx.font = `500 14px ${FONT}`;
  const measured = subtitle ? ctx.measureText(subtitle).width : 0;
  ctx.restore();
  const width = Math.min(w - 60, Math.max(480, measured + 48));
  const x = (w - width) / 2;
  panel(ctx, x, y, width, subtitle ? 84 : 56, { fill: 'rgba(41,26,63,.9)', stroke: color, lineWidth: 2, radius: 14 });
  text(ctx, title, w / 2, y + 32, { size: 24, weight: 800, color, align: 'center' });
  if (subtitle) {
    text(ctx, subtitle, w / 2, y + 62, { size: 14, weight: 500, color: C.cream, align: 'center' });
  }
}

export { C, FONT, MONO, SERVICES, roundRect, text, panel, meter, drawSky, drawClouds, drawHarbour, drawSea, drawContainer, drawWhale, drawGull, drawSplash, drawBanner };
