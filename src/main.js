/**
 * Wiring: overlays, level progression, HUD, touch controls and persistence.
 * All the rules live in rules.js; all the drawing lives in the level scenes.
 */

import { inject } from '@vercel/analytics';
import { createAudio } from './audio.js';
import { Engine } from './engine.js';
import { WaitStrategiesLevel } from './levels/level1-wait.js';
import { FlakyDetectiveLevel } from './levels/level2-flaky.js';
import { PipeDreamLevel } from './levels/level3-pipes.js';
import { RyukLevel } from './levels/level4-ryuk.js';
import { LEVELS, rank, totalScore } from './rules.js';
import { isUnlocked, load, recordResult, save } from './store.js';

// Initialize Vercel Web Analytics
inject();
const SCENES = {
  1: WaitStrategiesLevel, 2: FlakyDetectiveLevel, 3: PipeDreamLevel, 4: RyukLevel,
};

const TOUCH_CONTROLS = {
  2: [],
  3: [{ code: 'ArrowLeft', label: '←' }, { code: 'ArrowUp', label: '↑' },
    { code: 'ArrowDown', label: '↓' }, { code: 'ArrowRight', label: '→' },
    { code: 'Space', label: 'turn' }],
  4: [{ code: 'ArrowLeft', label: '←' }, { code: 'ArrowUp', label: '↑' },
    { code: 'ArrowDown', label: '↓' }, { code: 'ArrowRight', label: '→' }],
};

const els = {
  canvas: document.getElementById('game'),
  overlay: document.getElementById('overlay'),
  levelnav: document.getElementById('levelnav'),
  soundBtn: document.getElementById('soundBtn'),
  hudLevel: document.getElementById('hudLevel'),
  hudScore: document.getElementById('hudScore'),
  hudLives: document.getElementById('hudLives'),
  live: document.getElementById('live'),
  touchbar: document.getElementById('touchbar'),
  howtoGrid: document.getElementById('howtoGrid'),
};

let state = load();
let current = null;      // level id being played, null while an overlay owns the screen
let audio;
let engine;

/* ------------------------------------------------------------------ */
/* HUD and announcements                                               */
/* ------------------------------------------------------------------ */

function onHud({ level, score, lives }) {
  if (level) els.hudLevel.textContent = level;
  if (typeof score === 'number') els.hudScore.textContent = score.toLocaleString('en-US');
  if (typeof lives === 'number') {
    els.hudLives.textContent = lives > 0 ? '♥'.repeat(lives) : '—';
    els.hudLives.dataset.low = String(lives <= 1);
  }
}

let lastAnnounced = '';
function announce(message) {
  if (!message || message === lastAnnounced) return;
  lastAnnounced = message;
  els.live.textContent = message;
}

/* ------------------------------------------------------------------ */
/* Overlays                                                            */
/* ------------------------------------------------------------------ */

function showOverlay(card) {
  els.overlay.replaceChildren(card);
  els.overlay.hidden = false;
  els.touchbar.hidden = true;
  const focusable = card.querySelector('button');
  if (focusable) focusable.focus();
}

function hideOverlay() {
  els.overlay.hidden = true;
  els.overlay.replaceChildren();
}

function card({ eyebrow, title, body, takeaway, stats, actions }) {
  const el = document.createElement('div');
  el.className = 'card';
  if (eyebrow) el.append(h('p', { class: 'eyebrow' }, eyebrow));
  el.append(h('h2', {}, title));
  for (const paragraph of [].concat(body || [])) el.append(h('p', {}, paragraph));
  if (stats && stats.length) {
    const wrap = h('div', { class: 'stats' });
    for (const s of stats) wrap.append(h('div', {}, h('b', {}, String(s.value)), h('span', {}, s.label)));
    el.append(wrap);
  }
  if (takeaway) el.append(h('p', { class: 'takeaway' }, takeaway));
  if (actions && actions.length) {
    const row = h('div', { class: 'btn-row' });
    for (const a of actions) {
      const btn = h('button', { class: a.ghost ? 'btn ghost' : 'btn', type: 'button' }, a.label);
      btn.addEventListener('click', a.onClick);
      row.append(btn);
    }
    el.append(row);
  }
  return el;
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const child of children) el.append(child);
  return el;
}

function showMenu() {
  current = null;
  engine.setScene(null);
  const total = totalScore(state.best);
  const next = LEVELS.find((l) => isUnlocked(state, l.id) && !state.best[l.id]) || LEVELS[state.unlocked - 1];
  showOverlay(card({
    eyebrow: 'Spin · Test · Clean · Repeat',
    title: 'Testcontainers: the game',
    body: [
      'One level per thing that actually breaks a test suite: readiness, flakiness, networking and cleanup.',
      total ? `Career score ${total.toLocaleString('en-US')} · ${rank(total)}` : 'Nothing is more real than a flaky test. Start with wait strategies.',
    ],
    actions: [
      { label: `Play level ${next.id} · ${next.name}`, onClick: () => startLevel(next.id) },
      ...(total ? [{ label: 'Reset progress', ghost: true, onClick: resetProgress }] : []),
    ],
  }));
  announce('Main menu.');
  onHud({ level: 'Menu', score: total, lives: 0 });
}

function showBrief(levelId) {
  const level = LEVELS[levelId - 1];
  showOverlay(card({
    eyebrow: `Level ${level.id}`,
    title: level.name,
    body: [level.brief, level.controls],
    actions: [
      { label: 'Start', onClick: () => run(levelId) },
      { label: 'Menu', ghost: true, onClick: showMenu },
    ],
  }));
  announce(`Level ${level.id}, ${level.name}. ${level.brief} ${level.controls}`);
}

function showResult({ levelId, won, score, stats, takeaway }) {
  const level = LEVELS[levelId - 1];
  const unlockedNext = won && levelId < LEVELS.length;
  const actions = [];
  if (unlockedNext) actions.push({ label: `Level ${levelId + 1} · ${LEVELS[levelId].name}`, onClick: () => startLevel(levelId + 1) });
  actions.push({ label: won ? 'Play again' : 'Retry level', ghost: unlockedNext, onClick: () => run(levelId) });
  actions.push({ label: 'Menu', ghost: true, onClick: showMenu });

  showOverlay(card({
    eyebrow: `Level ${level.id} · ${level.name}`,
    title: won ? 'Suite green' : 'Suite red',
    body: won ? `You scored ${score.toLocaleString('en-US')} points.` : 'Out of lives. Nothing a rerun cannot fix.',
    stats,
    takeaway,
    actions,
  }));
  announce(`${won ? 'Level complete' : 'Level failed'}. Score ${score}. ${takeaway}`);
}

function showPause() {
  showOverlay(card({
    eyebrow: 'Paused',
    title: 'Take your time',
    body: 'The suite will wait. It always does.',
    actions: [
      { label: 'Resume', onClick: resume },
      { label: 'Restart level', ghost: true, onClick: () => run(current) },
      { label: 'Menu', ghost: true, onClick: showMenu },
    ],
  }));
  announce('Paused.');
}

/* ------------------------------------------------------------------ */
/* Flow                                                                */
/* ------------------------------------------------------------------ */

function startLevel(levelId) {
  audio.unlock();
  if (!isUnlocked(state, levelId)) return;
  showBrief(levelId);
}

function run(levelId) {
  audio.unlock();
  current = levelId;
  hideOverlay();
  engine.setScene(new SCENES[levelId]());
  renderTouchbar(levelId);
  els.canvas.focus({ preventScroll: true });
  syncNav();
}

function resume() {
  hideOverlay();
  renderTouchbar(current);
  engine.setPaused(false);
  els.canvas.focus({ preventScroll: true });
}

function onLevelEnd(result) {
  state = recordResult(state, result);
  save(state);
  current = null;
  engine.setScene(null);
  syncNav();
  renderHowto();
  showResult(result);
}

function resetProgress() {
  state = recordResult({ unlocked: 1, best: {}, sound: state.sound }, { levelId: 1, won: false, score: 0 });
  state.best = {};
  save(state);
  syncNav();
  renderHowto();
  showMenu();
}

/* ------------------------------------------------------------------ */
/* Chrome                                                              */
/* ------------------------------------------------------------------ */

function syncNav() {
  els.levelnav.replaceChildren();
  for (const level of LEVELS) {
    const unlocked = isUnlocked(state, level.id);
    const btn = h('button', { type: 'button' }, `${level.id}. ${level.name}`);
    if (!unlocked) {
      btn.disabled = true;
      btn.title = 'Finish the previous level to unlock';
    }
    btn.setAttribute('aria-current', String(current === level.id));
    btn.addEventListener('click', () => startLevel(level.id));
    els.levelnav.append(btn);
  }
}

function renderHowto() {
  els.howtoGrid.replaceChildren();
  for (const level of LEVELS) {
    const unlocked = isUnlocked(state, level.id);
    const best = state.best[level.id];
    const article = h('article', { 'data-locked': String(!unlocked) });
    article.append(h('h3', {}, h('span', {}, `Level ${level.id} — `), level.name));
    article.append(h('p', {}, unlocked ? level.brief : 'Locked. Clear the previous level to open it.'));
    article.append(h('p', {}, unlocked ? level.controls : ''));
    if (best) article.append(h('p', {}, `Best: ${best.toLocaleString('en-US')}`));
    els.howtoGrid.append(article);
  }
}

function renderTouchbar(levelId) {
  els.touchbar.replaceChildren();
  const controls = (engine.scene?.id === levelId && engine.scene.controls) || TOUCH_CONTROLS[levelId] || [];
  const coarse =
    window.matchMedia('(pointer: coarse)').matches ||
    navigator.maxTouchPoints > 0 ||
    'ontouchstart' in window;
  els.touchbar.hidden = !coarse || !controls.length;
  if (els.touchbar.hidden) return;

  for (const control of controls) {
    const btn = h('button', { type: 'button' }, control.label);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      engine.input.virtualPress(control.code);
    });
    const release = () => engine.input.virtualRelease(control.code);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('pointercancel', release);
    els.touchbar.append(btn);
  }
}

function syncSound() {
  els.soundBtn.setAttribute('aria-pressed', String(state.sound));
  els.soundBtn.classList.toggle('muted', !state.sound);
  audio.setEnabled(state.sound);
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function boot() {
  audio = createAudio(state.sound);
  engine = new Engine(els.canvas, { onHud, announce, audio });
  engine.hooks.onLevelEnd = onLevelEnd;
  engine.hooks.onControls = () => renderTouchbar(current);
  els.canvas.tabIndex = 0;

  els.soundBtn.addEventListener('click', () => {
    state = { ...state, sound: !state.sound };
    save(state);
    syncSound();
    if (state.sound) {
      audio.unlock();
      audio.play('pick');
    }
    announce(state.sound ? 'Sound on.' : 'Sound off.');
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLButtonElement && (e.code === 'Space' || e.code === 'Enter')) return;
    if (e.code === 'KeyP' && current) {
      e.preventDefault();
      if (els.overlay.hidden) {
        engine.setPaused(true);
        showPause();
      } else {
        resume();
      }
    } else if (e.code === 'Escape' && current) {
      e.preventDefault();
      showMenu();
    }
  });

  els.canvas.addEventListener('pointerdown', () => audio.unlock(), { once: true });

  syncSound();
  syncNav();
  renderHowto();
  showMenu();
  engine.start();
}

boot();
