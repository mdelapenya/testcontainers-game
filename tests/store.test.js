import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KEY, emptyState, isUnlocked, load, recordResult, sanitise, save } from '../src/store.js';

test('new players start at level one with sound on and independent score records', () => {
  assert.deepEqual(emptyState(), { unlocked: 1, best: {}, sound: true });
  assert.notEqual(emptyState().best, emptyState().best);
  assert.equal(isUnlocked(emptyState(), 1), true);
  assert.equal(isUnlocked(emptyState(), 2), false);
});

test('saved state is sanitised and unlocks stay within the four levels', () => {
  for (const raw of [null, undefined, 'invalid', 4]) assert.deepEqual(sanitise(raw), emptyState());
  assert.deepEqual(sanitise({ unlocked: 99, best: { 1: 12.9, 2: -1, 3: Infinity, 4: '500' }, sound: false }),
    { unlocked: 4, best: { 1: 12 }, sound: false });
  assert.equal(sanitise({ unlocked: -1 }).unlocked, 1);
  assert.equal(sanitise({ unlocked: 2.9 }).unlocked, 2);
  assert.equal(sanitise({ unlocked: NaN }).unlocked, 1);
});

test('winning unlocks the next level and preserves the original state', () => {
  const state = emptyState();
  const next = recordResult(state, { levelId: 1, won: true, score: 200.9 });
  assert.deepEqual(next, { unlocked: 2, best: { 1: 200 }, sound: true });
  assert.deepEqual(state, emptyState());
});

test('replays retain best scores and unlocks; losses do not unlock the next level', () => {
  const state = { unlocked: 4, best: { 1: 300 }, sound: false };
  for (const score of [200, -1, NaN, Infinity]) {
    assert.deepEqual(recordResult(state, { levelId: 1, won: false, score }), state);
  }
  assert.equal(recordResult(emptyState(), { levelId: 1, won: false, score: 100 }).unlocked, 1);
  assert.equal(recordResult(state, { levelId: 4, won: true, score: 100 }).unlocked, 4);
});

test('progress round trips through the existing storage key', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const state = { unlocked: 3, best: { 1: 300, 2: 200 }, sound: false };
  assert.deepEqual(load(storage), emptyState());
  assert.equal(save(state, storage), true);
  assert.ok(values.has(KEY));
  assert.deepEqual(load(storage), state);
  values.set(KEY, '{broken JSON');
  assert.deepEqual(load(storage), emptyState());
});

test('unavailable, blocked, or full storage does not prevent playing', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } };
  for (const storage of [null, blocked]) {
    assert.deepEqual(load(storage), emptyState());
    assert.equal(save(emptyState(), storage), false);
  }
});
