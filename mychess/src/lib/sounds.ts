/** Web Audio API sound effects. No-ops if AudioContext unavailable (SSR or blocked). */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return null; }
  }
  return ctx;
}

function tone(frequency: number, durationMs: number, type: OscillatorType = 'sine', gain = 0.3): void {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const vol = c.createGain();
  osc.connect(vol);
  vol.connect(c.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, c.currentTime);
  vol.gain.setValueAtTime(gain, c.currentTime);
  vol.gain.exponentialRampToValueAtTime(0.001, c.currentTime + durationMs / 1000);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + durationMs / 1000);
}

/** Pleasant ding for correct move */
export function playCorrect(): void {
  tone(880, 120, 'sine');
  setTimeout(() => tone(1100, 100, 'sine'), 100);
}

/** Low buzz for wrong move */
export function playWrong(): void {
  tone(220, 250, 'sawtooth', 0.2);
}

/** Triumphant fanfare for level-up or 10-chain */
export function playLevelUp(): void {
  tone(523, 100, 'sine');
  setTimeout(() => tone(659, 100, 'sine'), 110);
  setTimeout(() => tone(784, 150, 'sine'), 220);
  setTimeout(() => tone(1047, 300, 'sine'), 380);
}
