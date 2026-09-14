/** Tiny WebAudio blip synth — no asset files, no autoplay before a gesture. */

const TONES = {
  pick:    { f: 440, to: 620, d: 0.08, type: 'triangle', g: 0.16 },
  spin:    { f: 300, to: 480, d: 0.12, type: 'square',   g: 0.10 },
  ready:   { f: 660, to: 990, d: 0.16, type: 'triangle', g: 0.18 },
  pass:    { f: 520, to: 880, d: 0.22, type: 'sine',     g: 0.20 },
  fail:    { f: 300, to: 120, d: 0.28, type: 'sawtooth', g: 0.14 },
  clean:   { f: 780, to: 300, d: 0.14, type: 'sine',     g: 0.12 },
  land:    { f: 200, to: 150, d: 0.10, type: 'square',   g: 0.12 },
  win:     { f: 523, to: 1046, d: 0.42, type: 'triangle', g: 0.22 },
};

function createAudio(enabled) {
  let ctx = null;
  let on = enabled;

  function ensure() {
    if (!on) return null;
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  return {
    get enabled() { return on; },
    setEnabled(next) {
      on = next;
      if (!next && ctx) ctx.suspend();
    },
    unlock() { ensure(); },
    play(name) {
      const tone = TONES[name];
      const ac = tone ? ensure() : null;
      if (!ac) return;
      const t = ac.currentTime;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = tone.type;
      osc.frequency.setValueAtTime(tone.f, t);
      osc.frequency.exponentialRampToValueAtTime(tone.to, t + tone.d);
      gain.gain.setValueAtTime(tone.g, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + tone.d);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + tone.d + 0.02);
    },
  };
}

export { createAudio };
