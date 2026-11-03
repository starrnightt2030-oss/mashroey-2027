// Arabic read-aloud using the device's speech engine.
export const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

export function voicesReady() {
  if (!supported) return Promise.resolve([]);
  const v = speechSynthesis.getVoices();
  if (v.length) return Promise.resolve(v);
  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1800);
  });
}

export async function arabicVoices() {
  const all = await voicesReady();
  const ar = all.filter((v) => /^ar([-_]|$)/i.test(v.lang));
  const score = (v) => {
    let s = 0;
    if (/EG/i.test(v.lang)) s += 30;
    if (/natural|neural|online|premium|enhanced/i.test(v.name)) s += 20;
    if (/google|microsoft|samsung/i.test(v.name)) s += 10;
    if (/SA/i.test(v.lang)) s += 5;
    if (v.localService) s += 2;
    return s;
  };
  return ar.sort((a, b) => score(b) - score(a));
}

export async function pickVoice() {
  const list = await arabicVoices();
  let pref = null;
  try { pref = localStorage.getItem('tts-voice'); } catch (e) {}
  return list.find((v) => v.voiceURI === pref) || list[0] || null;
}

export function getRate() { try { return +(localStorage.getItem('tts-rate') || 1); } catch (e) { return 1; } }
export function setRate(r) { try { localStorage.setItem('tts-rate', String(r)); } catch (e) {} }

// Split text into natural sentences, each short enough to be spoken reliably.
export function chunkText(text) {
  // a line break ends a sentence only if the line ended with punctuation (otherwise it's just wrapping)
  const joined = String(text).replace(/([^.!?؟؛:])\n/g, '$1 ');
  const parts = joined.match(/[^.!?؟؛:\n]+[.!?؟؛:\n]*/g) || [];
  const out = [];
  for (let p of parts) {
    p = p.replace(/\s+/g, ' ').trim();
    if (!p || /^[\d\s\-–—.،,]+$/.test(p)) continue;
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

export class Speaker {
  constructor({ onCaption, onDone, onError } = {}) {
    this.onCaption = onCaption; this.onDone = onDone; this.onError = onError;
    this.chunks = []; this.i = 0; this.token = 0; this.playing = false;
    this.voice = null; this.rate = getRate();
  }
  async load(chunks, start = 0) {
    this.voice = await pickVoice();
    this.chunks = chunks; this.i = start;
  }
  play() {
    if (!supported) return;
    this.playing = true;
    speechSynthesis.cancel();
    this._speak(++this.token);
  }
  _speak(tok) {
    if (tok !== this.token || !this.playing) return;
    if (this.i >= this.chunks.length) { this.playing = false; this.onDone && this.onDone(); return; }
    const text = this.chunks[this.i];
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; } else u.lang = 'ar-EG';
    u.rate = this.rate; u.pitch = 1;
    u.onend = () => { if (tok === this.token && this.playing) { this.i++; this._speak(tok); } };
    u.onerror = (e) => {
      if (tok !== this.token) return;
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      this.i++; this._speak(tok);
    };
    this.onCaption && this.onCaption(text, this.i, this.chunks.length);
    speechSynthesis.speak(u);
  }
  pause() { this.playing = false; this.token++; if (supported) speechSynthesis.cancel(); }
  stop() { this.pause(); this.chunks = []; this.i = 0; }
  next() { if (this.i < this.chunks.length - 1) { this.i++; if (this.playing) this.play(); } }
  prev() { if (this.i > 0) { this.i--; if (this.playing) this.play(); } }
  setRate(r) { this.rate = r; setRate(r); if (this.playing) this.play(); }
}
