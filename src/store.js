/** Progress persistence. Pure helpers + a thin localStorage wrapper. */

import { LEVELS, unlockAfter } from './rules.js';
const KEY = 'testcontainers-game:v1';

function emptyState() {
  return { unlocked: 1, best: {}, sound: true };
}

/** Normalise anything that comes out of storage (or a previous version). */
function sanitise(raw) {
  const state = emptyState();
  if (!raw || typeof raw !== 'object') return state;
  if (Number.isFinite(raw.unlocked)) {
    state.unlocked = Math.min(LEVELS.length, Math.max(1, Math.floor(raw.unlocked)));
  }
  if (raw.best && typeof raw.best === 'object') {
    for (const [id, score] of Object.entries(raw.best)) {
      if (Number.isFinite(score) && score > 0) state.best[id] = Math.floor(score);
    }
  }
  state.sound = raw.sound !== false;
  return state;
}

/** Apply a finished level to the saved state. Returns a new state. */
function recordResult(state, { levelId, won, score }) {
  const next = { ...state, best: { ...state.best } };
  const previous = next.best[levelId] || 0;
  if (Number.isFinite(score) && score > previous) next.best[levelId] = Math.floor(score);
  next.unlocked = Math.max(next.unlocked, unlockAfter(levelId, won));
  return next;
}

function isUnlocked(state, levelId) {
  return levelId <= state.unlocked;
}

function load(storage = safeStorage()) {
  if (!storage) return emptyState();
  try {
    return sanitise(JSON.parse(storage.getItem(KEY)));
  } catch {
    return emptyState();
  }
}

function save(state, storage = safeStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false; // private mode: play on, just don't persist
  }
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export { KEY, emptyState, sanitise, recordResult, isUnlocked, load, save };
