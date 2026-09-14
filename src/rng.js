/** Deterministic PRNG so runs can be seeded (and tested). */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSeed() {
  return (Math.random() * 2 ** 32) >>> 0;
}

/** Uniform float in [min, max). */
function range(rng, min, max) {
  return min + rng() * (max - min);
}

/** Integer in [min, max]. */
function rangeInt(rng, min, max) {
  return Math.floor(range(rng, min, max + 1));
}

function pick(rng, list) {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

export { mulberry32, randomSeed, range, rangeInt, pick };
