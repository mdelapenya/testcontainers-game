import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mulberry32 } from '../src/rng.js';
import {
  CATALOG, STRATEGIES, strategyFor, L1, L2, L3, L4, CAUSES, DIRS, HOSTS,
  evaluateChoice, bestStrategy, costsLife, timeoutAt, roundLength, buildTimeline, probePips,
  buildRuns, isSolvable, isRed, FlakyBoard, rotate, PipeGrid, buildPipeGrid,
  HostBoard, hostIsConnected, sessionId, unlockAfter, totalScore, rank,
} from '../src/rules.js';

describe('wait strategies', () => {
  const spec = { readyAt: 2, fires: { port: 1, log: 2, http: null, sleep: 5 }, why: {} };

  test('early, ready, unsupported, and late strategies receive the right verdict and score', () => {
    for (const [strategy, verdict, points] of [
      ['port', 'flaky', 0], ['log', 'green', 300], ['http', 'unsupported', 0], ['sleep', 'slow', 40],
    ]) {
      const result = evaluateChoice(spec, strategy);
      assert.equal(result.verdict, verdict);
      assert.equal(result.points, points);
      assert.equal(costsLife(verdict), ['flaky', 'unsupported'].includes(verdict));
    }
  });

  test('the slow threshold is inclusive for green runs, with decreasing points', () => {
    const choice = (time) => evaluateChoice({ ...spec, fires: { log: time } }, 'log');
    assert.equal(choice(2.5).points, 220);
    assert.equal(choice(3).verdict, 'green');
    assert.equal(choice(3).points, 140);
    assert.equal(choice(3.001).verdict, 'slow');
  });

  test('every catalog service has a passing best strategy and meaningful explanations', () => {
    for (const service of CATALOG) {
      const best = evaluateChoice(service, bestStrategy(service));
      assert.equal(best.verdict, 'green', service.service);
      assert.equal(new Set(service.choices).size, 4);
      assert.ok(service.contract.length > 0);
      for (const strategy of service.choices) {
        assert.ok(STRATEGIES[strategy]);
        assert.ok(strategyFor(service, strategy).call.length > 0);
        const result = evaluateChoice(service, strategy);
        assert.ok(result.why.length > 0);
        assert.ok(best.points >= result.points);
      }
    }
  });

  test('the recommended check follows each scenario, rather than favouring logs or one key', () => {
    const expected = ['all', 'port', 'http', 'http', 'exec', 'sql', 'health'];
    assert.deepEqual(CATALOG.map(bestStrategy), expected);
    assert.ok(new Set(CATALOG.map((spec) => spec.choices.indexOf(bestStrategy(spec)))).size > 1);
    for (const spec of CATALOG) {
      assert.ok(evaluateChoice(spec, bestStrategy(spec)).points > evaluateChoice(spec, 'log').points);
    }
  });

  test('standalone logs that pass receive a fragile result without falsely costing a life', () => {
    for (const service of ['redis', 'mysql']) {
      const spec = CATALOG.find((spec) => spec.service === service);
      const result = evaluateChoice(spec, 'log');
      assert.equal(result.verdict, 'fragile');
      assert.equal(result.points, L1.FRAGILE_POINTS);
      assert.equal(costsLife(result.verdict), false);
      assert.ok(result.points < evaluateChoice(spec, bestStrategy(spec)).points);
    }
  });

  test('fragility does not hide early failures or unnecessary delays', () => {
    const fragile = { ...spec, fragile: ['port', 'sleep'] };
    assert.equal(evaluateChoice(fragile, 'port').verdict, 'flaky');
    assert.equal(evaluateChoice(fragile, 'sleep').verdict, 'slow');
  });

  test('the composed Postgres check waits for both startup messages and the port', () => {
    const postgres = CATALOG.find((spec) => spec.service === 'postgres');
    const logs = buildTimeline(postgres, mulberry32(7)).filter((line) => line.kind === 'ready');
    assert.deepEqual(logs.map((line) => line.t), [1.1, 3.0]);
    assert.equal(evaluateChoice(postgres, 'log').verdict, 'flaky');
    assert.ok(postgres.fires.all >= Math.max(postgres.fires.port, logs.at(-1).t));
    assert.equal(evaluateChoice(postgres, 'all').verdict, 'green');
  });

  test('Docker healthcheck and HTTP readiness are distinct requirements', () => {
    const keycloak = CATALOG.find((spec) => spec.service === 'keycloak');
    assert.equal(evaluateChoice(keycloak, 'health').verdict, 'unsupported');
    assert.equal(evaluateChoice(keycloak, 'http').verdict, 'green');
    assert.match(strategyFor(keycloak, 'http').call, /9000\/tcp/);
    const custom = CATALOG.find((spec) => spec.image === 'demo/nginx-health:1');
    assert.equal(evaluateChoice(custom, 'health').verdict, 'green');
  });

  test('animation duration covers readiness, late strategies, and timeouts', () => {
    assert.equal(timeoutAt(spec), 6);
    assert.equal(roundLength(spec, evaluateChoice(spec, 'port')), 1.042);
    assert.equal(roundLength(spec, evaluateChoice(spec, 'sleep')), 2.292);
    assert.equal(roundLength(spec, evaluateChoice(spec, 'http')), 2.708);
  });

  test('log timelines are deterministic and put the ready line at the strategy timestamp', () => {
    for (const spec of CATALOG) {
      const lines = buildTimeline(spec, mulberry32(17));
      assert.deepEqual(lines, buildTimeline(spec, mulberry32(17)));
      assert.deepEqual(lines.map((line) => line.t), lines.map((line) => line.t).sort((a, b) => a - b));
      assert.equal(lines.find((line) => line.kind === 'ready').t, spec.fires.log ?? spec.readyAt);
    }
  });

  test('probes stay red before readiness and green afterwards', () => {
    assert.deepEqual(probePips(1, L1.PROBE_START - 0.01), []);
    assert.deepEqual(probePips(1, 2), [{ t: 0.8, ok: false }, { t: 1.4, ok: true }, { t: 2, ok: true }]);
  });
});

describe('flaky detective', () => {
  test('all boards can be deduced from the initial visible runs across 100 seeds', () => {
    for (let seed = 0; seed < 100; seed++) {
      for (const spec of L2.BOARDS) {
        const board = new FlakyBoard({ ...spec, rng: mulberry32(seed) });
        assert.equal(isSolvable(board.runs.slice(0, board.revealed)), true);
        assert.equal(board.faults, spec.causes.length);
        assert.equal(board.rows.length, spec.tests);
      }
    }
  });

  test('the fallback matrix remains solvable when randomness repeats', () => {
    const runs = buildRuns(7, () => 0.5, 3);
    assert.equal(runs.length, 7);
    assert.equal(isSolvable(runs.slice(0, 3)), true);
    assert.equal(isSolvable([]), false);
  });

  test('failures follow each cause flag, with broken always red and healthy always green', () => {
    for (const run of buildRuns(7, mulberry32(3), 3)) {
      assert.equal(isRed(null, run), false);
      assert.equal(isRed('broken', run), true);
      for (const cause of ['port', 'state', 'wait', 'order']) {
        assert.equal(isRed(cause, run), run.flags[CAUSES[cause].flag]);
      }
    }
  });

  test('reruns spend budget, reveal evidence, and reduce the bonus', () => {
    const board = new FlakyBoard({ ...L2.BOARDS[0], rng: mulberry32(5) });
    const initialBonus = board.bonus();
    assert.equal(board.rerun().ok, true);
    assert.equal(board.revealed, L2.START_REVEALED + 1);
    assert.equal(board.bonus(), initialBonus - L2.RERUN_BONUS);
    assert.equal(board.cells(board.rows[0]).length, board.revealed);
    assert.equal(board.rerun().ok, true);
    assert.equal(board.rerun().ok, false);
    assert.equal(board.rerunsLeft, 0);
  });

  test('accusations penalise mistakes and award each correct answer only once', () => {
    const board = new FlakyBoard({ ...L2.BOARDS[0], rng: mulberry32(5) });
    const healthy = board.rows.find((row) => !row.cause);
    assert.equal(board.accuse(healthy.id, 'broken').correct, false);
    assert.equal(board.mistakes, 1);
    assert.equal(board.accuse(-1, 'broken').ok, false);
    assert.equal(board.accuse(healthy.id, 'unknown').ok, false);
    for (const row of board.rows.filter((row) => row.cause)) {
      assert.equal(board.accuse(row.id, row.cause).correct, true);
      assert.equal(board.accuse(row.id, row.cause).ok, false);
    }
    assert.equal(board.done, true);
    assert.equal(board.remaining, 0);
    assert.equal(board.score, board.faults * L2.POINTS_CORRECT);
  });
});

describe('pipe dream', () => {
  const straight = (gates = [0]) => new PipeGrid({
    cols: 3, rows: 1, wallX: 1, gates, srcRow: 0, dstRow: 0,
    cells: [{ mask: 10 }, { mask: 10 }, { mask: 10 }],
  });

  test('rotations wrap clockwise and anticlockwise for every pipe mask', () => {
    assert.equal(rotate(1), 2);
    assert.equal(rotate(1, -1), 8);
    for (let mask = 0; mask < 16; mask++) {
      assert.equal(rotate(mask, 4), mask);
      assert.equal(rotate(rotate(mask), -1), mask);
    }
  });

  test('only published ports allow pipes to cross the network wall', () => {
    const blocked = straight([]);
    assert.equal(blocked.linked(0, 0, 2), false);
    assert.equal(blocked.hasRoute(), false);
    assert.equal(blocked.canStillWin(), false);
    assert.equal(straight().hasRoute(), true);
  });

  test('flow advances one cell at a time and wet or locked pipes cannot rotate', () => {
    const grid = straight();
    assert.deepEqual(grid.advance(), []);
    assert.equal(grid.start(), true);
    assert.equal(grid.rotateAt(0, 0), false);
    assert.deepEqual(grid.advance(), [{ x: 1, y: 0 }]);
    assert.equal(grid.connected, false);
    assert.deepEqual(grid.advance(), [{ x: 2, y: 0 }]);
    assert.equal(grid.connected, true);
    assert.equal(grid.dry, 0);
    assert.deepEqual(grid.advance(), []);
    const dry = straight();
    dry.at(1, 0).locked = true;
    assert.equal(dry.rotateAt(1, 0), false);
    assert.equal(dry.rotateAt(-1, 0), false);
    assert.equal(dry.rotateAt(2, 0), true);
    assert.equal(dry.at(2, 0).mask, 5);
  });

  test('blocked entry and dead ends fail instead of connecting', () => {
    const entry = straight();
    entry.at(0, 0).mask = 5;
    assert.equal(entry.start(), false);
    assert.equal(entry.dead, true);
    const deadEnd = straight();
    deadEnd.at(1, 0).mask = 5;
    assert.equal(deadEnd.start(), true);
    assert.deepEqual(deadEnd.advance(), []);
    assert.equal(deadEnd.dead, true);
    assert.equal(deadEnd.connected, false);
  });

  test('all generated boards can be rotated into a winning route across 100 seeds', () => {
    for (let seed = 0; seed < 100; seed++) {
      for (const spec of L3.BOARDS) {
        const grid = buildPipeGrid(spec, mulberry32(seed));
        assert.equal(grid.canStillWin(), true);
        for (const cell of grid.cells) cell.mask = cell.solution;
        assert.equal(grid.hasRoute(), true);
        assert.equal(grid.start(), true);
        for (let step = 0; step < grid.cells.length && !grid.connected && !grid.dead; step++) grid.advance();
        assert.equal(grid.connected, true, `board ${spec.service}, seed ${seed}`);
      }
    }
  });
});

describe('Ryuk cleanup', () => {
  const board = () => new HostBoard({ ...L4.BOARDS[0], rng: mulberry32(12) });

  test('host layouts are connected and disconnected layouts are detected', () => {
    for (const host of HOSTS) assert.equal(hostIsConnected(host), true);
    assert.equal(hostIsConnected(['###', '###']), false);
    assert.equal(hostIsConnected(['.#.']), false);
  });

  test('generated resources are distinct and reachable without taking foreign resources', () => {
    for (let seed = 0; seed < 30; seed++) {
      for (const spec of L4.BOARDS) {
        const host = new HostBoard({ ...spec, rng: mulberry32(seed) });
        assert.equal(host.remaining, spec.mine);
        const foreign = host.items.filter((item) => !item.mine);
        assert.equal(foreign.length, spec.theirs);
        const ids = [host.session, ...foreign.map((item) => item.session), ...host.strays.map((stray) => stray.session)];
        assert.equal(new Set(ids).size, ids.length);
        const positions = [host.reaper, ...host.items, ...host.strays];
        assert.equal(new Set(positions.map((at) => host.key(at.x, at.y))).size, positions.length);
        assert.ok(positions.every((at) => !host.isWall(at.x, at.y)));
        assert.equal(host.walkable(new Set(foreign.map((item) => host.key(item.x, item.y)))), true);
      }
    }
  });

  test('own resources count once; foreign resources cost a mistake', () => {
    const host = board();
    const foreign = host.items.find((item) => !item.mine);
    assert.equal(host.reap(foreign.x, foreign.y).hit, true);
    assert.equal(host.mistakes, 1);
    assert.deepEqual(host.reap(foreign.x, foreign.y), {});
    for (const item of host.items.filter((item) => item.mine)) assert.equal(host.reap(item.x, item.y).hit, false);
    assert.equal(host.remaining, 0);
    assert.equal(host.reaped, L4.BOARDS[0].mine);
    assert.equal(host.over, true);
  });

  test('movement cannot cross walls and stray collisions include swapping positions', () => {
    const host = board();
    host.reaper = { x: 1, y: 1 };
    assert.deepEqual(host.moveReaper(DIRS.find((dir) => dir.name === 'w')), { moved: false });
    assert.equal(host.moveReaper(DIRS.find((dir) => dir.name === 'e')).moved, true);
    host.strays = [{ x: 1, y: 1 }];
    assert.equal(host.strayHit([{ x: 2, y: 1 }]), true);
    assert.equal(host.strayHit(), false);
    host.strays = [{ x: 2, y: 1 }];
    assert.equal(host.strayHit(), true);
  });

  test('strays remain on the host floor over repeated movement', () => {
    const host = board();
    for (let i = 0; i < 100; i++) {
      host.stepStrays();
      assert.ok(host.strays.every((stray) => !host.isWall(stray.x, stray.y)));
    }
  });

  test('time counts down to zero and freezes after cleanup', () => {
    const host = board();
    assert.equal(host.tick(1.5), false);
    assert.equal(host.left, 68.5);
    assert.equal(host.bonus, 69 * L4.POINTS_PER_SECOND);
    assert.equal(host.tick(100), true);
    assert.equal(host.left, 0);
    host.over = true;
    assert.equal(host.tick(1), false);
    assert.match(sessionId(mulberry32(10)), /^[0-9a-f]{4}$/);
  });
});

test('progression and rank thresholds cover all four levels', () => {
  assert.equal(unlockAfter(1, false), 1);
  assert.equal(unlockAfter(1, true), 2);
  assert.equal(unlockAfter(4, true), 4);
  assert.equal(totalScore({ 1: 100, 4: 200, 99: 999 }), 300);
  for (const [threshold, label] of [[1200, 'Test engineer'], [2600, 'CI whisperer'], [4200, 'Release manager'], [6000, 'Core maintainer']]) {
    assert.equal(rank(threshold), label);
    assert.notEqual(rank(threshold - 1), label);
  }
});
