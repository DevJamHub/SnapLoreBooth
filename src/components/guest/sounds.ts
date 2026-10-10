'use client';

/**
 * The booth's few sounds, synthesised with Web Audio so there are no files to load: a beep per
 * countdown second and a shutter click, and a voice from the device's own speech engine.
 * Browsers only allow sound after a tap, so the first tap (Mulai foto) unlocks it; until then
 * every sound is silently skipped.
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

/**
 * A voice for the guest's language on this device, if it has one (iPadOS has Indonesian
 * Damayanti; Android has Google's when its speech data is installed). Indonesian read by an
 * English voice sounds wrong, so without one the booth keeps to its beeps.
 */
function voiceFor(lang: string): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const match = new RegExp(`^${lang}([-_]|$)`, 'i');
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => match.test(v.lang) && v.localService) ?? voices.find((v) => match.test(v.lang)) ?? null;
}

/** Call from a tap: iOS only lets speech start inside one, and Chrome loads its voices late. */
export function unlockVoice() {
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.getVoices();
  const warm = new SpeechSynthesisUtterance(' ');
  warm.volume = 0;
  speechSynthesis.speak(warm);
}

/** Says `text` now in `lang`, cutting off whatever was being said. False when there is no voice to say it. */
export function speak(text: string, lang = 'id'): boolean {
  const voice = voiceFor(lang);
  if (!voice) return false;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = 1.05;
  utterance.pitch = 1.1;
  speechSynthesis.speak(utterance);
  return true;
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
