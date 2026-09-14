import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32, pick, randomSeed, range, rangeInt } from '../src/rng.js';

test('seeded runs are reproducible and different seeds produce different runs', () => {
  const sequence = (seed) => Array.from({ length: 100 }, mulberry32(seed));
  assert.deepEqual(sequence(42), sequence(42));
  assert.notDeepEqual(sequence(42), sequence(43));
  assert.ok(sequence(42).every((n) => n >= 0 && n < 1));
  assert.deepEqual(sequence(-1), sequence(0xffffffff));
});

test('ranges and choices include their documented endpoints', () => {
  assert.equal(range(() => 0, -5, 5), -5);
  assert.equal(range(() => 0.5, -5, 5), 0);
  assert.equal(rangeInt(() => 0, 2, 4), 2);
  assert.equal(rangeInt(() => 0.999999, 2, 4), 4);
  assert.equal(pick(() => 0, ['a', 'b']), 'a');
  assert.equal(pick(() => 0.999999, ['a', 'b']), 'b');
  const seed = randomSeed();
  assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff);
});
