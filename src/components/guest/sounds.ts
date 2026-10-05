'use client';

/**
 * The booth's few sounds, synthesised with Web Audio so there are no files to load: a beep per
 * countdown second and a shutter click. Browsers only allow sound after a tap, so the first
 * tap (Mulai foto) unlocks it; until then every sound is silently skipped.
 */
let context: AudioContext | null = null;

export function unlockSound() {
  try {
    const Audio = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) return;
    context ??= new Audio();
    if (context.state === 'suspended') void context.resume();
  } catch {
    context = null;
  }
}

export function beep(frequency = 880, ms = 140, volume = 0.18) {
  if (!context || context.state !== 'running') return;
  const now = context.currentTime;
  const tone = context.createOscillator();
  const gain = context.createGain();
  tone.type = 'sine';
  tone.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);
  tone.connect(gain).connect(context.destination);
  tone.start(now);
  tone.stop(now + ms / 1000 + 0.02);
}

/** A short burst of filtered noise: the click of a shutter. */
export function shutterSound(volume = 0.35) {
  if (!context || context.state !== 'running') return;
  const length = Math.round(context.sampleRate * 0.09);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = 'bandpass';
  filter.frequency.value = 2400;
  gain.gain.value = volume;
  source.connect(filter).connect(gain).connect(context.destination);
  source.start();
}
