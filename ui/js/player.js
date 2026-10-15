// Plays programs from the box server. A stream is a program started at some
// second (t0); seeking means opening a new stream, which the server starts in
// well under a second. While scanning (FF/REW) the picture is a series of still
// frames, the way a TiVo stuttered through its buffer. Subtitles for
// foreign-language programs are drawn here as captions.
//
// Between streams (a channel change, a rewind, a dropped connection) the last picture
// holds, like a cable box's freeze frame, and a "Please wait" box comes up if the next
// one takes more than a moment. The color-bar stand-by card is only for when there's
// no picture to hold.
import { PROGRAMS } from './data.js';
import { badge } from './art.js';

const LOADING_AFTER = 700; // ms of waiting before the "Please wait" box appears

export class Player {
  constructor(video, layer) {
    this.video = video;
    this.stillEl = document.createElement('img');
    this.stillEl.className = 'still';
    this.capEl = document.createElement('div');
    this.capEl.className = 'captions';
    this.standbyEl = document.createElement('div');
    this.standbyEl.className = 'standby';
    this.standbyEl.innerHTML = '<div class="s-title">Please stand by</div><div class="s-sub">We are experiencing technical difficulties</div>';
    this.freezeEl = document.createElement('canvas');
    this.freezeEl.className = 'freeze';
    this.freezeEl.width = 640;
    this.freezeEl.height = 480;
    this.loadingEl = document.createElement('div');
    this.loadingEl.className = 'loading';
    this.loadingEl.innerHTML = `<div class="l-badge">${badge()}</div><div class="l-text">Please wait</div>`;
    layer.prepend(this.freezeEl, this.stillEl, this.capEl, this.standbyEl, this.loadingEl);
    this.id = null;
    this.key = null;
    this.t0 = 0;
    this.cues = [];
    this.stillBusy = false;
    this.lastStill = 0;
    this.retryAt = 0;

    video.addEventListener('playing', () => {
      this.stillEl.classList.remove('on');
      this.standby(false);
      this.unfreeze();
      this.loading(false);
    });
    // the stream stalled mid-play: the picture holds by itself; say we're working on it
    video.addEventListener('waiting', () => { if (this.id) this.loading(true, 'Please wait'); });
    video.addEventListener('ended', () => { this.done = true; });
    video.addEventListener('error', () => this.failed());
    this.stillEl.addEventListener('load', () => { this.stillBusy = false; this.stillEl.classList.add('on'); });
    this.stillEl.addEventListener('error', () => { this.stillBusy = false; });
  }

  // key distinguishes two airings of the same program; t is seconds into the program
  open(id, t, key = id) {
    this.freeze();
    this.loading(true, 'Please wait');
    this.retryAt = 0;
    this.done = false;
    this.id = id;
    this.key = key;
    this.t0 = Math.max(0, t);
    this.video.src = `api/play?id=${encodeURIComponent(id)}&t=${this.t0.toFixed(1)}`;
    this.video.play().catch(() => {});
    this.loadCaptions(id, this.t0);
  }

  // hold: keep the last picture on screen (a channel change) until the next stream plays
  close({ hold = false } = {}) {
    if (hold) {
      this.freeze();
      if (this.frozen) this.loading(true, 'Please wait');
    } else {
      this.unfreeze();
      this.loading(false);
    }
    if (!this.id) return;
    this.id = this.key = null;
    this.done = false;
    this.video.removeAttribute('src');
    this.video.load();
    this.cues = [];
    this.capEl.textContent = '';
    this.stillEl.classList.remove('on');
  }

  is(key) { return this.key === key; }
  get time() { return this.t0 + this.video.currentTime; }
  get playing() { return !!this.id && !this.video.paused && this.video.readyState >= 3; }
  pause() { if (!this.video.paused) this.video.pause(); }
  resume() { if (this.id && this.video.paused) this.video.play().catch(() => {}); }

  // a still frame at t while scanning; one request in flight, a few per second
  still(id, t) {
    const now = performance.now();
    if (this.stillBusy || now - this.lastStill < 350 || PROGRAMS[id]?.k === 'live') return;
    this.stillBusy = true;
    this.lastStill = now;
    this.stillEl.src = `api/frame?id=${encodeURIComponent(id)}&t=${Math.max(0, t).toFixed(1)}`;
  }

  hideStill() { this.stillEl.classList.remove('on'); }

  standby(on) { this.standbyEl.classList.toggle('on', on); }

  // A dead stream shows the stand-by card; forgetting the key makes the owner reopen
  // it at the current position once canOpen() says enough time has passed.
  failed() {
    const err = this.video.error;
    if (!this.id || !err || err.code === MediaError.MEDIA_ERR_ABORTED) return;
    // hold the last picture while we try again; the color bars only if there's none
    if (!this.frozen) this.standby(true);
    this.loading(true, 'Reconnecting', 0);
    this.key = null;
    this.retryAt = performance.now() + 3000;
  }

  canOpen() { return performance.now() >= this.retryAt; }

  // ── freeze frame and the "Please wait" box ──
  freeze() {
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return; // nothing on screen to hold (keep any frame already held)
    try {
      this.freezeEl.getContext('2d').drawImage(v, 0, 0, 640, 480);
      this.freezeEl.classList.add('on');
      this.frozen = true;
    } catch { /* a frame we can't read: leave it */ }
  }

  unfreeze() {
    this.freezeEl.classList.remove('on');
    this.frozen = false;
  }

  // show after a short wait (so quick switches don't flash it), or at once with delay 0
  loading(on, text = 'Please wait', delay = LOADING_AFTER) {
    clearTimeout(this.loadingTimer);
    if (!on) { this.loadingEl.classList.remove('on'); return; }
    this.loadingEl.querySelector('.l-text').textContent = text;
    this.loadingTimer = setTimeout(() => this.loadingEl.classList.add('on'), delay);
  }

  // ── captions ──
  async loadCaptions(id, t0) {
    this.cues = [];
    this.capEl.textContent = '';
    const sub = PROGRAMS[id]?.sub;
    this.subWindow = null;
    if (!sub || sub.k === 'image') return;
    if (sub.k === 'vtt') {
      this.cues = parseVtt(await (await fetch(sub.u)).text(), 0);
    } else {
      await this.loadWindow(id, t0);
    }
  }

  async loadWindow(id, from) {
    const span = 600;
    this.subWindow = { id, end: from + span };
    const text = await (await fetch(`api/subs?id=${encodeURIComponent(id)}&t=${from.toFixed(1)}&d=${span}`)).text();
    if (this.id !== id) return;
    this.cues = [...this.cues.filter((c) => c.end > this.time - 30), ...parseVtt(text, from)];
  }

  // called every frame with the program time; also tops up the subtitle window
  drawCaptions(show) {
    if (!this.id || !this.cues.length && !this.subWindow) { this.capEl.textContent = ''; return; }
    const t = this.time;
    if (this.subWindow && this.subWindow.id === this.id && t > this.subWindow.end - 90 && !this.subWindow.loading) {
      this.subWindow.loading = true;
      this.loadWindow(this.id, this.subWindow.end);
    }
    const cue = show && this.cues.find((c) => c.start <= t && t < c.end);
    const text = cue ? cue.text : '';
    if (this.capEl.dataset.text !== text) {
      this.capEl.dataset.text = text;
      this.capEl.innerHTML = text ? text.split('\n').map((l) => `<span>${escape(l)}</span>`).join('<br>') : '';
    }
  }
}

function parseVtt(text, offset) {
  const cues = [];
  const time = (s) => {
    const p = s.trim().split(':').map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  };
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const body = lines.slice(i + 1).join('\n')
      .replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/\\N/g, '\n').trim();
    if (body) cues.push({ start: time(a) + offset, end: time(b.split(' ').filter(Boolean)[0]) + offset, text: body });
  }
  return cues;
}

function escape(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
