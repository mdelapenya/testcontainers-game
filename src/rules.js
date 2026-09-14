/**
 * Pure game rules — no canvas, no DOM, no timers.
 * Every level's decisions live here so they can be unit tested in isolation
 * (see tests/rules.test.js). The scenes only draw the state these produce.
 */

import { range } from './rng.js';
/* ================================================================== */
/* Level 1 — Wait strategies                                           */
/* ================================================================== */

/**
 * The four things people actually do while waiting for a container. Only the
 * first three are wait strategies; the sleep is here because everyone has
 * written it at least once.
 */
const STRATEGIES = {
  port: {
    key: 'port', name: 'Listening port',
    call: 'Wait.forListeningPort()',
    hint: 'Continue as soon as the port accepts a socket.',
    caption: 'fast, and famously a liar',
  },
  log: {
    key: 'log', name: 'Log message',
    call: 'Wait.forLogMessage(line, times)',
    hint: 'Continue when the readiness line shows up in the logs.',
    caption: 'exact, if you know the line',
  },
  http: {
    key: 'http', name: 'HTTP endpoint',
    call: 'Wait.forHttp(path).forStatusCode(200)',
    hint: 'Poll an endpoint until the service answers it.',
    caption: 'robust, costs you a poll interval',
  },
  sleep: {
    key: 'sleep', name: 'Fixed sleep',
    call: 'Thread.sleep(5000)',
    hint: 'Wait five seconds and hope for the best.',
    caption: 'green locally, red on CI',
  },
};

/**
 * One entry per service. `readyAt` is when the service can genuinely serve a
 * test; `fires[strategy]` is when that strategy would let the test start
 * (null when the strategy simply does not apply). Everything the player is
 * scored on derives from those two numbers, so a round has no reflex in it.
 */
const CATALOG = [
  {
    service: 'postgres', image: 'postgres:16-alpine',
    ready: 'database system is ready to accept connections',
    noise: [
      'starting PostgreSQL 16.2 on x86_64-pc-linux-musl',
      'listening on IPv4 address "0.0.0.0", port 5432',
      'database system was shut down at 10:02:11 UTC',
      'checkpoint starting: end-of-recovery immediate',
    ],
    readyAt: 3.0,
    fires: { port: 1.1, log: 3.0, http: null, sleep: 5.0 },
    why: {
      port: 'Postgres opens 5432 for its own bootstrap, then shuts it down and '
        + 'starts again. The socket is up long before the database will answer you.',
      log: 'The readiness line is the honest signal — and it is printed twice, '
        + 'so the module asks for it with withTimes(2).',
      http: 'Postgres speaks its own wire protocol. There is no HTTP endpoint to poll.',
      sleep: 'It passes, and it burns two seconds of every test run for nothing.',
    },
  },
  {
    service: 'redis', image: 'redis:7-alpine',
    ready: 'Ready to accept connections tcp',
    noise: [
      'oO0OoO0OoO0Oo Redis is starting oO0OoO0OoO0Oo',
      'Redis version=7.2.4, bits=64, just started',
      'Running mode=standalone, port=6379',
      'Server initialized',
    ],
    readyAt: 1.8,
    fires: { port: 1.65, log: 1.8, http: null, sleep: 5.0 },
    why: {
      port: 'Redis binds 6379 before it finishes loading the dataset. The gap is '
        + 'small on your laptop and exactly wide enough on a busy CI box.',
      log: '"Ready to accept connections" means it, which is why the module waits for it.',
      http: 'RESP is not HTTP. The poll would never get a 200.',
      sleep: '3.2 seconds of nothing, on every single test.',
    },
  },
  {
    service: 'nginx', image: 'nginx:1.27-alpine',
    ready: 'start worker processes',
    noise: [
      'using the "epoll" event method',
      'nginx/1.27.0',
      'built by gcc 13.2.1',
      'OS: Linux 6.6.32-linuxkit',
    ],
    readyAt: 1.0,
    fires: { port: 1.0, log: 1.35, http: 1.6, sleep: 5.0 },
    why: {
      port: 'Static nginx serves the moment it binds 80. Here the port really is '
        + 'the readiness signal, and it is the cheapest one.',
      log: 'Works, but you paid for a log scan to learn what the socket already told you.',
      http: 'Also correct, and worth it the day something real is served behind it — '
        + 'you just pay one poll interval.',
      sleep: 'Four wasted seconds guarding a container that was up in one.',
    },
  },
  {
    service: 'keycloak', image: 'quay.io/keycloak/keycloak:25.0',
    ready: 'Keycloak 25.0.0 on JVM started in 7.2s, listening on :8080',
    noise: [
      'Updating the configuration and installing your custom providers',
      'Importing realm "test" from file',
      'Hibernate ORM core version 6.4.4.Final',
      'Database JDBC URL [jdbc:h2:mem:keycloakdb]',
    ],
    readyAt: 8.0,
    fires: { port: 2.4, log: 7.4, http: 8.2, sleep: 5.0 },
    why: {
      port: '8080 is bound while the realm import is still running. Your first '
        + 'token request meets a half-built server.',
      log: 'The banner prints while the realm import is still running. A log line '
        + 'only helps when the service publishes it as a readiness contract, and this one is not.',
      http: '/health/ready is the contract Keycloak publishes for exactly this '
        + 'question. It is the only signal here that is true when it says so.',
      sleep: 'Five seconds is not eight. This is the flake that only shows up in CI.',
    },
  },
  {
    service: 'kafka', image: 'confluentinc/cp-kafka:7.6.0',
    ready: '[KafkaServer id=1] started (kafka.server.KafkaServer)',
    noise: [
      'Awaiting socket connections on 0.0.0.0:9092',
      'Registered broker 1 at path /brokers/ids/1',
      'Session establishment complete on zookeeper:2181',
      '[KafkaServer id=1] starting (kafka.server.KafkaServer)',
    ],
    readyAt: 5.2,
    fires: { port: 1.9, log: 5.2, http: null, sleep: 5.0 },
    why: {
      port: '9092 is listening while the broker is still joining the cluster. '
        + 'Producing to it gets you a metadata error, not a green test.',
      log: 'The broker says "started" once it means it. Wait for that line.',
      http: 'The broker port speaks the Kafka protocol, not HTTP.',
      sleep: 'Five seconds against a 5.2 second boot. You lose that coin flip in CI.',
    },
  },
  {
    service: 'mysql', image: 'mysql:8.0',
    ready: 'ready for connections. Version: 8.0.36',
    noise: [
      'InnoDB initialization has started',
      'Initializing database files, this may take a while',
      'Temporary server started',
      'Temporary server stopped',
    ],
    readyAt: 6.5,
    fires: { port: 2.2, log: 6.5, http: null, sleep: 5.0 },
    why: {
      port: 'The entrypoint starts a temporary server to initialise the data '
        + 'directory, then stops it. You connect to a database that is about to vanish.',
      log: 'The second "ready for connections" is the real one — the module counts them.',
      http: 'MySQL has no HTTP endpoint on 3306.',
      sleep: 'Six and a half seconds of boot against a five second guess.',
    },
  },
];

const L1 = {
  ROUNDS: 5,
  LIVES: 3,
  /** Dead time past readiness that turns a passing strategy into a slow suite. */
  SLOW_AFTER: 1.0,
  /** How long the test waits before it gives up when the strategy never fires. */
  TIMEOUT_GRACE: 4,
  /** Wall-clock is compressed so an eight second boot is not eight seconds of game. */
  PLAY_SPEED: 2.4,
  PROBE_START: 0.8,
  PROBE_INTERVAL: 0.6,
  MAX_POINTS: 300,
  POINTS_PER_SECOND: 160,
  MIN_POINTS: 60,
  SLOW_POINTS: 40,
};

/** Verdicts that mean the suite went red, and cost a life. */
const FAILING = ['flaky', 'unsupported'];

/**
 * What the chosen strategy does to this service. No player timing involved:
 * the strategy fires when it fires, and the test is green, flaky or slow
 * because of that.
 */
function evaluateChoice(spec, strategy) {
  const firedAt = spec.fires[strategy];
  const why = spec.why[strategy];

  if (firedAt == null) {
    return { strategy, verdict: 'unsupported', firedAt: null, wasted: 0, points: 0, why };
  }

  const wasted = round3(firedAt - spec.readyAt);
  if (wasted < 0) {
    return { strategy, verdict: 'flaky', firedAt, wasted, points: 0, why };
  }
  if (wasted > L1.SLOW_AFTER) {
    return { strategy, verdict: 'slow', firedAt, wasted, points: L1.SLOW_POINTS, why };
  }
  return { strategy, verdict: 'green', firedAt, wasted, points: greenPoints(wasted), why };
}

/** Points for a green run: the less dead time it bought, the better. */
function greenPoints(wasted) {
  return Math.max(L1.MIN_POINTS, Math.round(L1.MAX_POINTS - wasted * L1.POINTS_PER_SECOND));
}

/** The strategy this service deserves: highest scoring, ties broken by speed. */
function bestStrategy(spec) {
  return Object.keys(STRATEGIES)
    .map((key) => evaluateChoice(spec, key))
    .sort((a, b) => b.points - a.points || a.wasted - b.wasted)[0].strategy;
}

function costsLife(verdict) {
  return FAILING.includes(verdict);
}

/** When the test gives up if the strategy never fires. */
function timeoutAt(spec) {
  return round3(spec.readyAt + L1.TIMEOUT_GRACE);
}

/** How long the round's animation runs, in compressed seconds. */
function roundLength(spec, outcome) {
  const end = outcome.firedAt == null ? timeoutAt(spec) : Math.max(outcome.firedAt, spec.readyAt);
  return round3((end + 0.5) / L1.PLAY_SPEED);
}

/** Log lines with timestamps: noise before readiness, the real line exactly at it. */
function buildTimeline(spec, rng) {
  const logAt = spec.fires.log == null ? spec.readyAt : spec.fires.log;
  const lines = [];
  const count = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < count; i++) {
    lines.push({
      t: 0.25 + (logAt - 0.5) * ((i + rng() * 0.6) / count),
      text: spec.noise[i % spec.noise.length],
      kind: 'noise',
    });
  }
  lines.push({ t: logAt, text: spec.ready, kind: 'ready' });
  lines.push({ t: logAt + 0.9, text: 'connection accepted from 172.17.0.1', kind: 'noise' });
  return lines.sort((a, b) => a.t - b.t);
}

/** Health-probe pips up to `clock`; the first 200 lands at or after readiness. */
function probePips(readyAt, clock) {
  const pips = [];
  for (let t = L1.PROBE_START; t <= clock + 1e-9; t += L1.PROBE_INTERVAL) {
    pips.push({ t: round3(t), ok: t >= readyAt });
  }
  return pips;
}

/* ================================================================== */
/* Level 2 — The flaky detective                                       */
/* ================================================================== */

/**
 * What a CI run did differently. A flaky test does not fail at random: it
 * fails when one of these is true, and the player's job is to spot which.
 */
const RUN_FLAGS = [
  { key: 'parallel', short: 'P', label: 'parallel forks' },
  { key: 'shared', short: 'S', label: 'one shared database' },
  { key: 'load', short: 'L', label: 'busy runner' },
  { key: 'shuffled', short: 'O', label: 'shuffled test order' },
];

/**
 * The five verdicts. Four flaky causes, each tied to the condition that
 * triggers it, plus the honest red: a test that is simply broken.
 */
const CAUSES = {
  broken: {
    key: 'broken', name: 'Real failure', flag: null,
    tell: 'Red in every single run.',
    fix: 'Nothing to quarantine here. The test is right and the code is wrong.',
  },
  port: {
    key: 'port', name: 'Fixed port clash', flag: 'parallel',
    tell: 'Only red when the suite runs in parallel forks.',
    fix: 'Somebody called withFixedExposedPort. Two forks, one host port, one loser. '
      + 'Let Testcontainers map the port and read it back with getMappedPort().',
  },
  state: {
    key: 'state', name: 'Shared state', flag: 'shared',
    tell: 'Only red when every test shares one database.',
    fix: 'A test before it left rows behind. Give it its own container, or reset the '
      + 'schema between tests — a shared container is a shared fixture.',
  },
  wait: {
    key: 'wait', name: 'No wait strategy', flag: 'load',
    tell: 'Only red when the runner is busy.',
    fix: 'It passes on an idle laptop and fails on a loaded runner: the classic '
      + 'readiness race. Give the container a wait strategy instead of luck.',
  },
  order: {
    key: 'order', name: 'Order dependence', flag: 'shuffled',
    tell: 'Only red when the runner shuffles the test order.',
    fix: 'This test needs another one to run first. A container per test class makes '
      + 'the dependency impossible to hide.',
  },
};

const L2 = {
  ROUNDS: 3,
  LIVES: 3,
  POINTS_CORRECT: 200,
  RERUN_BONUS: 60,
  /**
   * Columns already on the board when a round opens. Three is the floor for an
   * honest puzzle: one column tells you nothing, so starting there would force a
   * guess and charge a life for it.
   */
  START_REVEALED: 3,
  /**
   * Rows, faulty rows and which causes can appear, per round. A board is
   * START_REVEALED columns wide plus one per re-run you are allowed to buy, so
   * the evidence on offer is always enough to name every cause — the bonus is for
   * not needing all of it.
   */
  BOARDS: [
    { tests: 5, causes: ['broken', 'state'], reruns: 2 },
    { tests: 6, causes: ['state', 'port', 'broken'], reruns: 3 },
    { tests: 7, causes: ['wait', 'order', 'port', 'state'], reruns: 4 },
  ],
};

/** Plausible-looking test names; the fun is in the pattern, not the noun. */
const TEST_NAMES = [
  'OrderRepositoryTest.findsByCustomer',
  'PaymentServiceIT.refundsAnOrder',
  'CatalogSearchIT.matchesBySku',
  'InventoryIT.reservesStock',
  'CheckoutFlowIT.appliesCoupon',
  'ShippingRatesIT.quotesOvernight',
  'AuditLogIT.writesOnDelete',
  'UserSessionIT.expiresAfterIdle',
  'WebhookDispatchIT.retriesOnce',
];

/**
 * A run matrix where every flag is true somewhere, false somewhere, and no two
 * flags share a column pattern — otherwise two causes would be indistinguishable
 * and the board would not be solvable by deduction.
 *
 * The guarantee has to hold on the columns the player can actually see, not just
 * on the finished matrix: `minPrefix` is the number of columns revealed from the
 * start. Checking that prefix is enough, because extra columns can only tell two
 * flags apart, never merge them back together.
 */
function buildRuns(count, rng, minPrefix = count) {
  const prefix = Math.max(1, Math.min(minPrefix, count));
  for (let attempt = 0; attempt < 400; attempt++) {
    const runs = [];
    for (let i = 0; i < count; i++) {
      const flags = {};
      for (const flag of RUN_FLAGS) flags[flag.key] = rng() < 0.42;
      runs.push({ id: i + 1, flags });
    }
    if (isSolvable(runs.slice(0, prefix))) return runs;
  }
  return fallbackRuns(count);
}

/** Every flag must vary, and no two flags may fire on the same runs. */
function isSolvable(runs) {
  const columns = RUN_FLAGS.map((flag) => runs.map((run) => run.flags[flag.key]));
  for (const column of columns) {
    if (!column.includes(true) || !column.includes(false)) return false;
  }
  for (let i = 0; i < columns.length; i++) {
    for (let j = i + 1; j < columns.length; j++) {
      if (columns[i].every((v, k) => v === columns[j][k])) return false;
    }
  }
  return true;
}

/**
 * Deterministic matrix used when the dice refuse to cooperate. The seeds are four
 * distinct, non-constant three-bit patterns, so even a three-column board keeps
 * every flag apart; wider boards repeat them shifted.
 */
const FALLBACK_SEEDS = [0b011, 0b101, 0b110, 0b001];

function fallbackRuns(count) {
  return Array.from({ length: count }, (_, i) => {
    const flags = {};
    RUN_FLAGS.forEach((flag, f) => {
      const seed = FALLBACK_SEEDS[f];
      flags[flag.key] = i < 3 ? Boolean(seed & (1 << i)) : Boolean(seed & (1 << ((i + f) % 3)));
    });
    return { id: i + 1, flags };
  });
}

/** Is this test red in this run? Broken is always red; flaky needs its trigger. */
function isRed(cause, run) {
  if (!cause) return false;
  const flag = CAUSES[cause].flag;
  return flag === null ? true : run.flags[flag];
}

/**
 * One board of the level: a matrix of tests by CI runs, most of it hidden.
 * Re-running reveals one more column and costs budget; accusing a test of a
 * cause is checked against the hidden truth.
 */
class FlakyBoard {
  constructor({ rng, tests, causes, reruns = 4, runs = reruns + L2.START_REVEALED } = {}) {
    this.rng = rng || (() => 0.5);
    this.revealed = Math.min(L2.START_REVEALED, runs);
    this.runs = buildRuns(runs, this.rng, this.revealed);
    this.rerunsLeft = reruns;
    this.mistakes = 0;
    this.score = 0;

    const names = shuffle(TEST_NAMES.slice(), this.rng).slice(0, tests);
    const faulty = shuffle(Array.from({ length: tests }, (_, i) => i), this.rng)
      .slice(0, causes.length);
    this.rows = names.map((name, i) => ({
      id: i,
      name,
      cause: faulty.includes(i) ? causes[faulty.indexOf(i)] : null,
      verdict: null,
      solved: false,
    }));
  }

  /** How many faulty tests are hiding in there — the board tells you up front. */
  get faults() {
    return this.rows.filter((r) => r.cause).length;
  }

  get remaining() {
    return this.rows.filter((r) => r.cause && !r.solved).length;
  }

  get done() {
    return this.remaining === 0;
  }

  /** Red/green for the runs revealed so far. */
  cells(row) {
    return this.runs.slice(0, this.revealed).map((run) => isRed(row.cause, run));
  }

  canRerun() {
    return this.rerunsLeft > 0 && this.revealed < this.runs.length;
  }

  /** Spend one rerun to reveal another column of evidence. */
  rerun() {
    if (!this.canRerun()) return { ok: false };
    this.rerunsLeft -= 1;
    this.revealed += 1;
    return { ok: true, run: this.runs[this.revealed - 1] };
  }

  /** Name a cause for a test. Wrong accusations cost a life. */
  accuse(rowId, cause) {
    const row = this.rows.find((r) => r.id === rowId);
    if (!row || row.solved || !CAUSES[cause]) return { ok: false };
    row.verdict = cause;
    if (row.cause === cause) {
      row.solved = true;
      this.score += L2.POINTS_CORRECT;
      return { ok: true, correct: true, cause, points: L2.POINTS_CORRECT };
    }
    this.mistakes += 1;
    return { ok: true, correct: false, cause, truth: row.cause, points: 0 };
  }

  /** Unspent CI minutes are worth points; evidence is not free. */
  bonus() {
    return this.rerunsLeft * L2.RERUN_BONUS;
  }
}

function shuffle(items, rng) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ================================================================== */
/* Level 3 — Pipe Dream                                                */
/* ================================================================== */

/**
 * Pipes as bitmasks: which sides of a cell are open. Rotating a piece rotates
 * its bits, which is the whole physics of this level.
 */
const DIRS = [
  { name: 'n', bit: 1, dx: 0, dy: -1, back: 4 },
  { name: 'e', bit: 2, dx: 1, dy: 0, back: 8 },
  { name: 's', bit: 4, dx: 0, dy: 1, back: 1 },
  { name: 'w', bit: 8, dx: -1, dy: 0, back: 2 },
];

/** The pieces the generator scatters around the board, as unrotated masks. */
const PIECES = [3, 6, 12, 9, 5, 10, 7, 14, 13, 11];

const L3 = {
  ROUNDS: 3,
  LIVES: 3,
  /** Seconds the water spends filling one cell. */
  FILL_TIME: 0.9,
  POINTS_CONNECT: 250,
  POINTS_PER_DRY: 15,
  BOARDS: [
    { cols: 6, rows: 4, wallX: 3, gates: [1], srcRow: 1, dstRow: 2, lead: 14, port: 5432, service: 'postgres' },
    { cols: 7, rows: 5, wallX: 3, gates: [1, 3], srcRow: 2, dstRow: 1, lead: 13, port: 6379, service: 'redis' },
    { cols: 8, rows: 5, wallX: 4, gates: [2], srcRow: 0, dstRow: 4, lead: 12, port: 9092, service: 'kafka' },
  ],
};

/** Turn a mask a quarter turn clockwise, `times` times. */
function rotate(mask, times = 1) {
  let m = mask & 15;
  const turns = ((times % 4) + 4) % 4;
  for (let i = 0; i < turns; i++) m = ((m << 1) | (m >> 3)) & 15;
  return m;
}

function opens(mask, bit) {
  return (mask & bit) !== 0;
}

function dirOf(bit) {
  return DIRS.find((d) => d.bit === bit);
}

/**
 * The board. The wall between host and Docker network runs down the left edge
 * of column `wallX`, and pipes may only cross it on a gate row — that gate is
 * the published port, and there is no other way in.
 */
class PipeGrid {
  constructor({ cols, rows, wallX, gates, srcRow, dstRow, cells }) {
    this.cols = cols;
    this.rows = rows;
    this.wallX = wallX;
    this.gates = gates.slice();
    this.srcRow = srcRow;
    this.dstRow = dstRow;
    this.cells = cells;
    this.filled = new Set();
    this.flowing = false;
    this.dead = false;
    this.connected = false;
  }

  key(x, y) {
    return y * this.cols + x;
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  at(x, y) {
    return this.inside(x, y) ? this.cells[this.key(x, y)] : null;
  }

  isFilled(x, y) {
    return this.filled.has(this.key(x, y));
  }

  isGate(y) {
    return this.gates.includes(y);
  }

  /** Does the wall stand between these two horizontally adjacent cells? */
  crossesWall(x, dx) {
    return dx === 1 ? x + 1 === this.wallX : x === this.wallX;
  }

  /** Can water flow out of (x,y) through `bit` into the neighbour? */
  linked(x, y, bit) {
    const dir = dirOf(bit);
    const from = this.at(x, y);
    const to = this.at(x + dir.dx, y + dir.dy);
    if (!from || !to) return false;
    if (!opens(from.mask, bit) || !opens(to.mask, dir.back)) return false;
    if (dir.dy === 0 && this.crossesWall(x, dir.dx) && !this.isGate(y)) return false;
    return true;
  }

  /** Rotating is free, but only while the cell is still dry. */
  rotateAt(x, y, times = 1) {
    const cell = this.at(x, y);
    if (!cell || cell.locked || this.isFilled(x, y)) return false;
    cell.mask = rotate(cell.mask, times);
    cell.turns = (cell.turns || 0) + 1;
    return true;
  }

  /** The test hands its connection to the first cell; it has to be open to it. */
  start() {
    this.flowing = true;
    const entry = this.at(0, this.srcRow);
    if (!entry || !opens(entry.mask, 8)) {
      this.dead = true;
      return false;
    }
    this.filled.add(this.key(0, this.srcRow));
    this.checkArrival();
    return true;
  }

  /** One tick of water: every cell touching the wet set fills at once. */
  advance() {
    if (!this.flowing || this.dead || this.connected) return [];
    const next = [];
    for (const k of this.filled) {
      const x = k % this.cols;
      const y = Math.floor(k / this.cols);
      for (const dir of DIRS) {
        if (!this.linked(x, y, dir.bit)) continue;
        const nk = this.key(x + dir.dx, y + dir.dy);
        if (!this.filled.has(nk) && !next.includes(nk)) next.push(nk);
      }
    }
    if (!next.length) {
      this.dead = true;
      return [];
    }
    for (const k of next) this.filled.add(k);
    this.checkArrival();
    return next.map((k) => ({ x: k % this.cols, y: Math.floor(k / this.cols) }));
  }

  /** The container is reached when wet pipe leaves the last column eastwards. */
  checkArrival() {
    const exit = this.at(this.cols - 1, this.dstRow);
    if (exit && opens(exit.mask, 2) && this.isFilled(this.cols - 1, this.dstRow)) {
      this.connected = true;
    }
  }

  /** Is there a complete route right now, water or no water? */
  hasRoute() {
    const entry = this.at(0, this.srcRow);
    if (!entry || !opens(entry.mask, 8)) return false;
    const seen = new Set([this.key(0, this.srcRow)]);
    const stack = [[0, this.srcRow]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x === this.cols - 1 && y === this.dstRow && opens(this.at(x, y).mask, 2)) return true;
      for (const dir of DIRS) {
        if (!this.linked(x, y, dir.bit)) continue;
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (seen.has(this.key(nx, ny))) continue;
        seen.add(this.key(nx, ny));
        stack.push([nx, ny]);
      }
    }
    return false;
  }

  /**
   * Optimistic check: is a winning route still reachable by rotating the dry
   * cells? Wet pipe is frozen, so a leak can genuinely lock the player out and
   * we would rather say so than let the clock run down in silence.
   */
  canStillWin() {
    const seen = new Set();
    const stack = [];
    const entry = this.at(0, this.srcRow);
    if (!entry) return false;
    for (const mask of this.options(0, this.srcRow)) {
      if (opens(mask, 8)) stack.push({ x: 0, y: this.srcRow, mask });
    }
    while (stack.length) {
      const at = stack.pop();
      const id = this.key(at.x, at.y) * 16 + at.mask;
      if (seen.has(id)) continue;
      seen.add(id);
      if (at.x === this.cols - 1 && at.y === this.dstRow && opens(at.mask, 2)) return true;
      for (const dir of DIRS) {
        if (!opens(at.mask, dir.bit)) continue;
        if (dir.dy === 0 && this.crossesWall(at.x, dir.dx) && !this.isGate(at.y)) continue;
        const nx = at.x + dir.dx;
        const ny = at.y + dir.dy;
        if (!this.inside(nx, ny)) continue;
        for (const mask of this.options(nx, ny)) {
          if (opens(mask, dir.back)) stack.push({ x: nx, y: ny, mask });
        }
      }
    }
    return false;
  }

  /** Every mask a cell could show: one if the water already froze it, else four. */
  options(x, y) {
    const cell = this.at(x, y);
    if (!cell) return [];
    if (this.isFilled(x, y) || cell.locked) return [cell.mask];
    return [0, 1, 2, 3].map((t) => rotate(cell.mask, t));
  }

  get dry() {
    return this.cols * this.rows - this.filled.size;
  }
}

/**
 * Carve a route from the test to the container through one of the gates, fill
 * the rest of the board with junk pipe, then spin everything out of alignment.
 * Rotation can never destroy the solution, so every board is always solvable.
 */
function buildPipeGrid(spec, rng) {
  const { cols, rows, wallX, gates, srcRow, dstRow } = spec;
  const gate = gates[Math.floor(rng() * gates.length)];
  const route = [
    ...carve({ cols: wallX, rows }, { x: 0, y: srcRow }, { x: wallX - 1, y: gate }, rng),
    ...carve({ cols: cols - wallX, rows }, { x: 0, y: gate }, { x: cols - wallX - 1, y: dstRow }, rng)
      .map((p) => ({ x: p.x + wallX, y: p.y })),
  ];

  const cells = Array.from({ length: cols * rows }, () => ({ mask: 0, solution: 0, turns: 0, route: false }));
  const index = (p) => p.y * cols + p.x;
  route.forEach((p, i) => {
    const cell = cells[index(p)];
    cell.route = true;
    const prev = route[i - 1];
    const next = route[i + 1];
    cell.mask |= prev ? between(p, prev) : 8;          // the test comes in from the west
    cell.mask |= next ? between(p, next) : 2;          // the container is out east
  });

  for (const cell of cells) {
    if (!cell.route) cell.mask = PIECES[Math.floor(rng() * PIECES.length)];
    cell.solution = cell.mask;   // kept for the solver in the tests, never shown
    cell.mask = rotate(cell.mask, Math.floor(rng() * 4));
    cell.turns = 0;
  }

  const grid = new PipeGrid({ ...spec, cells });
  // A board that opens already connected is not a puzzle: nudge one route piece.
  if (grid.hasRoute()) {
    const victim = cells.find((c) => c.route && rotate(c.mask, 1) !== c.mask);
    if (victim) victim.mask = rotate(victim.mask, 1);
  }
  return grid;
}

/** Which way does `b` lie from `a`? */
function between(a, b) {
  return DIRS.find((d) => a.x + d.dx === b.x && a.y + d.dy === b.y).bit;
}

/** A wandering, self-avoiding walk through one side of the board. */
function carve(region, from, to, rng) {
  const seen = new Set([from.y * region.cols + from.x]);
  const path = [from];
  const walk = (at) => {
    if (at.x === to.x && at.y === to.y) return true;
    const options = shuffle(DIRS.slice(), rng).sort((a, b) => pull(at, a, to) - pull(at, b, to));
    for (const dir of options) {
      const next = { x: at.x + dir.dx, y: at.y + dir.dy };
      if (next.x < 0 || next.y < 0 || next.x >= region.cols || next.y >= region.rows) continue;
      const k = next.y * region.cols + next.x;
      if (seen.has(k)) continue;
      seen.add(k);
      path.push(next);
      if (walk(next)) return true;
      path.pop();
      seen.delete(k);
    }
    return false;
  };
  walk(from);
  return path;
}

/** Prefer steps that head for the exit, but not so strongly that it is a straight line. */
function pull(at, dir, to) {
  const dx = to.x - at.x;
  const dy = to.y - at.y;
  return -(dir.dx * Math.sign(dx) + dir.dy * Math.sign(dy));
}



/* ================================================================== */
/* Level 4 — Ryuk                                                      */
/* ================================================================== */

/**
 * The host, as a maze. '#' is something you cannot walk through — a daemon
 * socket, a bind mount, another job's workspace — and '.' is free floor.
 */
const HOSTS = [
  [
    '#################',
    '#...............#',
    '#.##.##...##.##.#',
    '#.#...#...#...#.#',
    '#...#.......#...#',
    '#.#...#...#...#.#',
    '#.##.##...##.##.#',
    '#...............#',
    '#################',
  ],
  [
    '#################',
    '#...#.......#...#',
    '#.#.#.#####.#.#.#',
    '#.#.....#.....#.#',
    '#.#####.#.#####.#',
    '#.#.....#.....#.#',
    '#.#.#.#####.#.#.#',
    '#...#.......#...#',
    '#################',
  ],
  [
    '#################',
    '#.....#...#.....#',
    '###.#.#.#.#.#.###',
    '#...#...#...#...#',
    '#.#####.#.#####.#',
    '#...#...#...#...#',
    '###.#.#.#.#.#.###',
    '#.....#...#.....#',
    '#################',
  ],
];

/** What Testcontainers leaves behind, and what Ryuk is allowed to take. */
const SPOILS = [
  { kind: 'container', short: 'C', label: 'container' },
  { kind: 'network', short: 'N', label: 'network' },
  { kind: 'volume', short: 'V', label: 'volume' },
];

const L4 = {
  ROUNDS: 3,
  LIVES: 3,
  POINTS_ITEM: 60,
  POINTS_PER_SECOND: 4,
  /**
   * Seconds per cell. The strays are deliberately slower than you. A maze this
   * dense puts a junction every cell or two, so the step is also the window you
   * get to decide at each one: at 0.13 the level was reflex, not routing.
   */
  STEP: 0.2,
  STRAY_STEP: 0.34,
  /** Clocks are sized for the slower pace — roughly 1.5x the old budgets. */
  BOARDS: [
    { host: 0, mine: 12, theirs: 3, strays: 1, seconds: 70 },
    { host: 1, mine: 14, theirs: 4, strays: 2, seconds: 78 },
    { host: 2, mine: 16, theirs: 5, strays: 3, seconds: 85 },
  ],
};

/** A four-hex session id, the label Ryuk actually matches on. */
function sessionId(rng) {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 4; i++) out += hex[Math.floor(rng() * 16)];
  return out;
}

/**
 * One host to clean up. The reaper walks the maze, takes everything carrying
 * its own session label and must leave every other label alone.
 */
class HostBoard {
  constructor({ rng, host, mine, theirs, strays, seconds } = {}) {
    const plan = HOSTS[host];
    this.rows = plan.length;
    this.cols = plan[0].length;
    this.walls = new Set();
    this.floor = [];
    plan.forEach((line, y) => {
      [...line].forEach((char, x) => {
        if (char === '#') this.walls.add(this.key(x, y));
        else this.floor.push({ x, y });
      });
    });

    this.session = sessionId(rng);
    this.left = seconds;
    this.reaped = 0;
    this.mistakes = 0;
    this.over = false;

    // Every other build on this host gets a label of its own, and none of them
    // may collide with yours: the whole level is "does this string match mine".
    const used = new Set([this.session]);
    const foreign = () => {
      let id = sessionId(rng);
      while (used.has(id)) id = sessionId(rng);
      used.add(id);
      return id;
    };

    const open = shuffle(this.floor.slice(), rng);
    this.reaper = { ...open.pop(), dir: null, next: null };
    this.items = [];
    for (let i = 0; i < mine; i++) {
      const at = open.pop();
      if (at) this.items.push({ ...at, kind: SPOILS[i % SPOILS.length].kind, mine: true, taken: false });
    }
    // Somebody else's resource is a tile you must not step on, so it can never
    // sit in the one corridor that leads somewhere: park them where removing
    // the tile still leaves the whole host walkable.
    const blocked = new Set();
    for (let i = 0; i < theirs; i++) {
      const spot = open.findIndex((at) => {
        blocked.add(this.key(at.x, at.y));
        const fine = this.walkable(blocked);
        blocked.delete(this.key(at.x, at.y));
        return fine;
      });
      if (spot < 0) break;
      const at = open.splice(spot, 1)[0];
      blocked.add(this.key(at.x, at.y));
      this.items.push({
        ...at, kind: SPOILS[(i + 1) % SPOILS.length].kind, mine: false, taken: false, session: foreign(),
      });
    }
    this.strays = [];
    for (let i = 0; i < strays; i++) {
      const at = open.pop();
      if (at) this.strays.push({ ...at, dir: DIRS[Math.floor(rng() * 4)], session: foreign() });
    }
    this.rng = rng;
  }

  key(x, y) {
    return y * this.cols + x;
  }

  isWall(x, y) {
    return x < 0 || y < 0 || x >= this.cols || y >= this.rows || this.walls.has(this.key(x, y));
  }

  /** Can every floor tile still be reached if these tiles were off limits? */
  walkable(blocked) {
    const free = this.floor.filter((at) => !blocked.has(this.key(at.x, at.y)));
    if (!free.length) return false;
    const seen = new Set([this.key(free[0].x, free[0].y)]);
    const stack = [free[0]];
    while (stack.length) {
      const at = stack.pop();
      for (const dir of DIRS) {
        const nx = at.x + dir.dx;
        const ny = at.y + dir.dy;
        const id = this.key(nx, ny);
        if (this.isWall(nx, ny) || blocked.has(id) || seen.has(id)) continue;
        seen.add(id);
        stack.push({ x: nx, y: ny });
      }
    }
    return seen.size === free.length;
  }

  /** Step the reaper one cell. Returns what it walked into. */
  moveReaper(dir) {
    const nx = this.reaper.x + dir.dx;
    const ny = this.reaper.y + dir.dy;
    if (this.isWall(nx, ny)) return { moved: false };
    this.reaper.prev = { x: this.reaper.x, y: this.reaper.y };
    this.reaper.x = nx;
    this.reaper.y = ny;
    this.reaper.dir = dir;
    return { moved: true, ...this.reap(nx, ny) };
  }

  /** Take whatever is under the reaper — including what it should not have. */
  reap(x, y) {
    const item = this.items.find((i) => !i.taken && i.x === x && i.y === y);
    if (!item) return {};
    item.taken = true;
    if (item.mine) {
      this.reaped += 1;
      if (this.remaining === 0) this.over = true;
      return { item, hit: false };
    }
    this.mistakes += 1;
    return { item, hit: true };
  }

  /** Strays keep going until the wall stops them, then pick a new way. */
  stepStrays() {
    for (const stray of this.strays) {
      const options = DIRS.filter((d) => !this.isWall(stray.x + d.dx, stray.y + d.dy));
      if (!options.length) continue;
      const straight = options.filter((d) => d !== dirOf(stray.dir.back));
      const pool = straight.length ? straight : options;
      const ahead = pool.includes(stray.dir);
      // Hold the line most of the time; a junction is a coin toss.
      const dir = ahead && this.rng() < 0.7 ? stray.dir : pool[Math.floor(this.rng() * pool.length)];
      stray.dir = dir;
      stray.x += dir.dx;
      stray.y += dir.dy;
    }
  }

  /**
   * Did a stray land on the reaper, or swap places with it? Pass the strays'
   * positions from before the step to catch the two walking through each other.
   */
  strayHit(before = []) {
    const here = this.reaper;
    const prev = here.prev;
    return this.strays.some((stray, i) => {
      if (stray.x === here.x && stray.y === here.y) return true;
      const was = before[i];
      if (!was || !prev) return false;
      return was.x === here.x && was.y === here.y && stray.x === prev.x && stray.y === prev.y;
    });
  }

  tick(dt) {
    if (this.over) return false;
    this.left = Math.max(0, this.left - dt);
    return this.left === 0;
  }

  get remaining() {
    return this.items.filter((i) => i.mine && !i.taken).length;
  }

  get bonus() {
    return Math.round(this.left) * L4.POINTS_PER_SECOND;
  }
}

/** Every floor tile has to be walkable from every other one. */
function hostIsConnected(plan) {
  const rows = plan.length;
  const cols = plan[0].length;
  const floor = [];
  plan.forEach((line, y) => [...line].forEach((char, x) => {
    if (char !== '#') floor.push(`${x},${y}`);
  }));
  if (!floor.length) return false;
  const seen = new Set([floor[0]]);
  const stack = [floor[0].split(',').map(Number)];
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const dir of DIRS) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (plan[ny][nx] === '#') continue;
      const id = `${nx},${ny}`;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push([nx, ny]);
    }
  }
  return seen.size === floor.length;
}

/* ================================================================== */
/* Progression                                                         */
/* ================================================================== */

const LEVELS = [
  {
    id: 1,
    name: 'Wait strategies',
    tagline: 'Know when a container is actually ready',
    brief: 'A container boots and a test is waiting for it. You pick the wait strategy; Testcontainers runs the test by itself. Choose wrong and the suite is flaky, slow, or stuck.',
    controls: 'Keys 1 / 2 / 3 / 4 pick a strategy (or tap a card) · press Space or tap to continue after a result',
  },
  {
    id: 2,
    name: 'The flaky detective',
    tagline: 'Tell a broken test from a flaky one',
    brief: 'A grid of tests by CI runs. Each column is one run, tagged with what that run did: P parallel forks, S one shared database, L busy runner, O shuffled order. Each cause below the grid fails under exactly one of those tags — a broken test fails under all of them. Three runs are on the board from the start, and that is already enough to name every cause: line up the tag that was lit in exactly the runs where the test went red. Re-runs buy you extra columns when you want to be sure.',
    controls: 'Pick a test (tap it, or ↑ ↓) · pick a cause (tap it, or keys 1–5) — the grid lights up the runs that cause needs · choose the same cause again to accuse · R or RE-RUN reveals one more column and reduces your bonus',
  },
  {
    id: 3,
    name: 'Pipe Dream',
    tagline: 'The published port is the only way in',
    brief: 'Your test is on the host, the container is on a Docker network, and a wall stands between them. Rotate the pipes into a route before the connection pool opens — the wall can only be crossed on a published port.',
    controls: 'Arrows move the cursor · Space / Enter rotates the selected piece · click or tap a piece to select and rotate it · the water freezes whatever it touches',
  },
  {
    id: 4,
    name: 'Ryuk',
    tagline: 'Cleanup is a label, not a shutdown hook',
    brief: 'A Docker host shared by several builds at once, littered with containers, networks and volumes. Collect everything tagged with your own session label before the clock runs out — take somebody else\'s and you have just broken their build.',
    controls: 'Arrows / WASD steer (or tap the host) · collect resources with your session label · avoid resources and moving ghosts belonging to other builds',
  },
];

function unlockAfter(levelId, won) {
  if (!won) return levelId;
  return Math.min(LEVELS.length, levelId + 1);
}

function totalScore(best) {
  return LEVELS.reduce((sum, level) => sum + (best[level.id] || 0), 0);
}

function rank(total) {
  if (total >= 6000) return 'Core maintainer';
  if (total >= 4200) return 'Release manager';
  if (total >= 2600) return 'CI whisperer';
  if (total >= 1200) return 'Test engineer';
  return 'Intern with a laptop fan problem';
}

/* ------------------------------------------------------------------ */

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

export { STRATEGIES, CATALOG, L1, FAILING, evaluateChoice, greenPoints, bestStrategy, costsLife, timeoutAt, roundLength, buildTimeline, probePips, RUN_FLAGS, CAUSES, L2, TEST_NAMES, buildRuns, isSolvable, isRed, FlakyBoard, DIRS, PIECES, L3, rotate, opens, dirOf, PipeGrid, buildPipeGrid, HOSTS, SPOILS, L4, sessionId, HostBoard, hostIsConnected, LEVELS, unlockAfter, totalScore, rank, clamp };
