// Read-aloud using the device's speech engine.
// Arabic parts are spoken with an Arabic voice and English words (units, terms) with an English
// voice, so mixed text like "تقاس بوحدة m/s" sounds natural instead of a strange accent.
export const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

export function voicesReady() {
  if (!supported) return Promise.resolve([]);
  const v = speechSynthesis.getVoices();
  if (v.length) return Promise.resolve(v);
  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 2000);
  });
}

function rank(v, local) {
  let s = 0;
  if (/google/i.test(v.name)) s += 30;               // Google voices are the clearest on Android
  if (/natural|neural|online|premium|enhanced/i.test(v.name)) s += 20;
  if (/microsoft|samsung|apple|siri/i.test(v.name)) s += 10;
  if (local && local.test(v.lang)) s += 6;
  if (v.localService) s += 2;
  return s;
}
export async function arabicVoices() {
  const all = await voicesReady();
  return all.filter((v) => /^ar([-_]|$)/i.test(v.lang)).sort((a, b) => rank(b, /EG|SA/i) - rank(a, /EG|SA/i));
}
async function englishVoice() {
  const all = await voicesReady();
  return all.filter((v) => /^en([-_]|$)/i.test(v.lang)).sort((a, b) => rank(b, /US|GB/i) - rank(a, /US|GB/i))[0] || null;
}
export async function pickVoice() {
  const list = await arabicVoices();
  let pref = null;
  try { pref = localStorage.getItem('tts-voice'); } catch (e) {}
  return list.find((v) => v.voiceURI === pref) || list[0] || null;
}

export function getRate() { try { return +(localStorage.getItem('tts-rate') || 1); } catch (e) { return 1; } }
export function setRate(r) { try { localStorage.setItem('tts-rate', String(r)); } catch (e) {} }

// Text whose stored characters are scrambled (old Word fonts): lots of letters that never
// appear in real Arabic words.
export function looksGarbled(text) {
  const letters = (text.match(/[\u0621-\u064A]/g) || []).length;
  if (letters < 20) return false;
  const odd = (text.match(/[\u063B-\u063F\u0656-\u065F]/g) || []).length;
  const marks = (text.match(/[\u064B-\u0652]/g) || []).length;
  return odd / letters > 0.03 || (marks / letters > 0.25 && odd > 3);
}

// Split text into natural sentences, each short enough to be spoken reliably.
export function chunkText(text) {
  // a line break ends a sentence only if the line ended with punctuation (otherwise it's just wrapping)
  const joined = String(text).replace(/([^.!?؟؛:])\n/g, '$1 ');
  const parts = joined.match(/[^.!?؟؛:\n]+[.!?؟؛:\n]*/g) || [];
  const out = [];
  for (let p of parts) {
    p = p.replace(/\s+/g, ' ').trim();
    if (!p || /^[\d\s\-–—.،,()]+$/.test(p)) continue;
    while (p.length > 220) {
      let cut = p.lastIndexOf('،', 200);
      if (cut < 60) cut = p.lastIndexOf(' ', 200);
      if (cut < 60) cut = 200;
      out.push(p.slice(0, cut + 1).trim());
      p = p.slice(cut + 1).trim();
    }
    if (p) out.push(p);
  }
  return out;
}

// Split one sentence into Arabic / English runs.
const LATIN_RUN = /[A-Za-z][A-Za-z0-9'’.\-\/\\^²³]*(?:\s+[A-Za-z0-9][A-Za-z0-9'’.\-\/\\^²³]*)*/g;
export function langRuns(s) {
  const runs = [];
  let last = 0, m;
  LATIN_RUN.lastIndex = 0;
  while ((m = LATIN_RUN.exec(s))) {
    if (m.index > last) runs.push({ t: s.slice(last, m.index), en: false });
    runs.push({ t: m[0].replace(/[\\/]/g, ' / '), en: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) runs.push({ t: s.slice(last), en: false });
  return runs.filter((r) => /[\p{L}\p{N}]/u.test(r.t));
}

export class Speaker {
  constructor({ onCaption, onDone } = {}) {
    this.onCaption = onCaption; this.onDone = onDone;
    this.chunks = []; this.i = 0; this.token = 0; this.playing = false;
    this.voice = null; this.en = null; this.rate = getRate();
  }
  async load(chunks, start = 0) {
    this.voice = await pickVoice();
    this.en = await englishVoice();
    this.chunks = chunks; this.i = start;
  }
  play() {
    if (!supported) return;
    this.playing = true;
    speechSynthesis.cancel();
    this._speak(++this.token);
  }
  _utter(text, en) {
    const u = new SpeechSynthesisUtterance(text);
    const v = en ? this.en : this.voice;
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = en ? 'en-US' : 'ar-SA';
    u.rate = this.rate; u.pitch = 1;
    return u;
  }
  _speak(tok) {
    if (tok !== this.token || !this.playing) return;
    if (this.i >= this.chunks.length) { this.playing = false; this.onDone && this.onDone(); return; }
    const text = this.chunks[this.i];
    const runs = langRuns(text);
    this.onCaption && this.onCaption(text, this.i, this.chunks.length);
    if (!runs.length) { this.i++; return this._speak(tok); }
    runs.forEach((r, k) => {
      const u = this._utter(r.t.trim(), r.en);
      if (k === runs.length - 1) {
        u.onend = () => { if (tok === this.token && this.playing) { this.i++; this._speak(tok); } };
        u.onerror = (e) => { if (tok !== this.token || e.error === 'interrupted' || e.error === 'canceled') return; this.i++; this._speak(tok); };
      }
      speechSynthesis.speak(u);
    });
  }
  pause() { this.playing = false; this.token++; if (supported) speechSynthesis.cancel(); }
  stop() { this.pause(); this.chunks = []; this.i = 0; }
  setRate(r) { this.rate = r; setRate(r); if (this.playing) this.play(); }
}
