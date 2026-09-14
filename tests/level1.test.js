import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WaitStrategiesLevel } from '../src/levels/level1-wait.js';
import { CATALOG, L1, bestStrategy, roundLength } from '../src/rules.js';

function startScenario(index) {
  const events = { controls: 0, announcements: [], results: [] };
  const engine = {
    hooks: {
      onControls: () => events.controls++,
      onLevelEnd: (result) => events.results.push(result),
    },
    hud() {}, sfx() {},
    announce: (message) => events.announcements.push(message),
    input: { takePresses: () => [], takeTaps: () => [] },
  };
  const level = new WaitStrategiesLevel();
  level.enter(engine);
  level.order = CATALOG.map((_, i) => (index + i) % CATALOG.length);
  level.startRound();
  return { level, events };
}

test('each number key and touch label matches that round’s card', () => {
  for (let scenario = 0; scenario < CATALOG.length; scenario++) {
    for (let choice = 0; choice < 4; choice++) {
      const { level } = startScenario(scenario);
      const control = level.controls[choice];
      assert.equal(control.label, `${choice + 1} · ${level.choices[choice].name}`);
      level.onKey(control.code);
      assert.equal(level.strategy, CATALOG[scenario].choices[choice]);
      assert.equal(level.phase, 'run');
    }
  }
});

test('each round announces its contract and refreshes touch controls', () => {
  const { level, events } = startScenario(0);
  const previous = level.controls;
  level.onKey('Key3');
  level.update(roundLength(level.spec, level.outcome));
  level.onKey('Space');
  assert.equal(level.spec.service, 'redis');
  assert.notDeepEqual(level.controls, previous);
  assert.equal(events.controls, 3);
  assert.ok(events.announcements.at(-1).includes(level.spec.contract));
});

test('a passing fragile choice awards reduced points and retains the player’s lives', () => {
  const { level } = startScenario(1);
  level.pick('log');
  level.update(roundLength(level.spec, level.outcome));
  assert.equal(level.phase, 'result');
  assert.equal(level.lives, L1.LIVES);
  assert.equal(level.greens, 1);
  assert.equal(level.score, L1.FRAGILE_POINTS);
  assert.match(level.detail(), /brittle/);
});

test('unsupported healthchecks never show a successful probe', () => {
  const { level } = startScenario(3);
  level.pick('health');
  level.update(roundLength(level.spec, level.outcome));
  assert.ok(level.probe.pips.length > 0);
  assert.ok(level.probe.pips.every((pip) => !pip.ok));
  assert.equal(level.lives, L1.LIVES - 1);
});

test('a player can complete the level using the recommended checks', () => {
  const { level, events } = startScenario(0);
  let points = 0;
  for (let i = 0; i < L1.ROUNDS; i++) {
    level.pick(bestStrategy(level.spec));
    points += level.outcome.points;
    level.update(roundLength(level.spec, level.outcome));
    level.onKey('Space');
  }
  assert.equal(events.results.length, 1);
  assert.equal(events.results[0].won, true);
  assert.equal(events.results[0].score, points);
  assert.equal(level.lives, L1.LIVES);
});
