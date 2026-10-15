// Live TV: the video layer plus everything drawn over it — channel/info banner,
// trickplay status bar, channel-number entry, and the grid guide.
import { h, clamp } from './dom.js';
import { badge, background, dot, logoChip, thumbs, trickIcon } from './art.js';
import { CHANNELS, airingAt, channelIndex, segmentAt, streamOf } from './data.js';
import { MIN, clock, hm, range, duration, elapsed, dayDate } from './time.js';
import { describe } from './screens.js';
import { Guide } from './guide.js';
import { Player } from './player.js';
import { WeatherStar } from './weatherstar.js';
import { GolfWeather } from './golfwx.js';
import { recordable, toggleRecording } from './dvr.js';
import * as sfx from './sound.js';

// rewind's top speed is much faster than TiVo's 60x: a two-hour film rewinds in about 20 seconds
const RATES = { play: 1, pause: 0, slow: 0.25, ff1: 3, ff2: 20, ff3: 60, rew1: -5, rew2: -60, rew3: -360 };
// Leaving a fast speed jumps back a little so you land where you meant to (TiVo's overshoot correction).
const OVERSHOOT = { ff2: -5e3, ff3: -14e3, rew2: 8e3, rew3: 45e3 };
const BANNER_MS = { mini: 4000, full: 10000 };
const TRICK_MS = 3500;

// Live or recording timeline. Live times are wall-clock ms; recordings are offsets.
// Everything is recorded, so a live buffer reaches back to the start of the
// program that was on when you tuned in.
class Timeline {
  live(start) {
    const now = Date.now();
    Object.assign(this, { isLive: true, start: Math.min(start, now), end: now, pos: now });
  }
  recording(durMs, pos = 0) {
    Object.assign(this, { isLive: false, start: 0, end: durMs, pos });
  }
  advance(dt, rate) {
    if (this.isLive) this.end = Date.now();
    if (rate === 0) return null;
    this.pos += dt * rate;
    if (this.pos >= this.end) { this.pos = this.end; return 'end'; }
    if (this.pos <= this.start) { this.pos = this.start; return 'start'; }
    return null;
  }
  get atEnd() { return this.end - this.pos < (this.isLive ? 5000 : 1500); }
  get atStart() { return this.pos - this.start < 1500; }
}

class Banner {
  constructor() {
    this.el = h('div', { class: 'banner' });
    this.el.innerHTML = `
      <div class="b-badge">${badge()}</div>
      <div class="b-rec">${dot('red', 13)}</div>
      <div class="b-head">
        <div class="b-row1"><div class="b-title"></div><div class="b-thumbs"></div><div class="b-net"></div><div class="b-clock"></div></div>
        <div class="b-row2"><div class="b-sub"></div><div class="b-rating"></div><div class="b-chan"></div></div>
      </div>
      <div class="b-body">
        <div class="b-desc"><div class="d-text"></div><div class="d-foot"></div></div>
        <div class="b-icons"><span class="tag">CC</span><span class="tag hd">STEREO</span></div>
      </div>`;
    this.$ = (sel) => this.el.querySelector(sel);
    this.mode = null;
  }

  get on() { return this.mode !== null; }

  show(mode, info) {
    this.mode = mode;
    this.info = info;
    this.el.className = `banner on ${mode}`;
    this.fill();
  }

  hide() { this.mode = null; this.el.className = 'banner'; }

  fill() {
    const { ch, airing, rec } = this.info;
    const s = airing.show;
    const now = Date.now();
    this.$('.b-title').textContent = s.title;
    this.$('.b-clock').textContent = clock(now);
    this.$('.b-net').innerHTML = s.movie || !ch || ch.logo ? '' : `<span class="netchip">${ch.call}</span>`;
    if (rec) {
      this.$('.b-sub').textContent = duration(rec.dur);
      this.$('.b-chan').innerHTML = ch?.logo ? logoChip(ch, 44, 18) : 'TiVo';
      this.$('.d-foot').textContent = `Recorded: ${dayDate(rec.start)} ${clock(rec.start)}  ${ch ? `${ch.num} ${ch.call}` : rec.call}`;
    } else {
      this.$('.b-sub').textContent = `${range(airing.start, airing.end)}${airing.epTitle ? `   "${airing.epTitle}"` : ''}`;
      this.$('.b-chan').innerHTML = ch.logo ? `${ch.num} ${logoChip(ch, 44, 18)}` : `${ch.num} ${ch.call}`;
      this.$('.d-foot').textContent = `${dayDate(airing.start)}  ${range(airing.start, airing.end)}  ${ch.num} ${ch.call}`;
    }
    this.$('.b-rating').textContent = s.rating || 'No Rating';
    this.$('.d-text').textContent = describe(airing);
    const t = this.$('.b-thumbs');
    t.innerHTML = s.thumbs ? thumbs(s.thumbs > 0, Math.abs(s.thumbs)) : '';
    t.classList.toggle('on', !!s.thumbs);
    this.el.classList.toggle('recording', !!(airing.recording || rec?.status === 'recording'));
  }
}

class TrickBar {
  constructor() {
    this.el = h('div', { class: 'trick' });
    this.el.innerHTML = `
      <div class="t-track"></div>
      <div class="t-lab l"></div><div class="t-lab r"></div>
      <div class="t-bar"><div class="t-fill"></div><div class="t-ticks"></div><div class="t-head"></div></div>
      <div class="t-time"></div>
      <div class="t-state"></div>`;
    this.$ = (sel) => this.el.querySelector(sel);
    this.on = false;
  }

  show() { this.on = true; this.el.classList.add('on'); }
  hide() { this.on = false; this.el.classList.remove('on'); }

  // Live: the program you're in, start to end on the clock; green up to now
  // (everything is recorded), dark where it hasn't aired yet.
  // Recording: 0:00 to the show's length, all green.
  update(tl, state, slot) {
    const BAR_X = 62, BAR_W = 560 - 124;
    let w0, w1, label;
    if (tl.isLive) {
      w0 = slot.start;
      w1 = slot.end;
      this.$('.t-lab.l').textContent = hm(w0);
      this.$('.t-lab.r').textContent = hm(w1);
      label = hm(tl.pos);
    } else {
      w0 = 0; w1 = tl.end;
      this.$('.t-lab.l').textContent = '0:00';
      this.$('.t-lab.r').textContent = elapsed(tl.end);
      label = elapsed(tl.pos);
    }
    const x = (t) => clamp((t - w0) / (w1 - w0), 0, 1) * BAR_W;
    const fill = this.$('.t-fill');
    fill.style.left = `${x(tl.start)}px`;
    fill.style.width = `${x(tl.end) - x(tl.start)}px`;
    const head = x(tl.pos);
    this.$('.t-head').style.left = `${head}px`;
    this.$('.t-time').style.left = `${BAR_X + head}px`;
    this.$('.t-time').textContent = label;
    this.$('.t-state').style.left = `${BAR_X + head}px`;
    if (this.state !== state) { this.$('.t-state').innerHTML = trickIcon(state); this.state = state; }
    const key = `${w0}:${w1}`;
    if (this.tickKey !== key) {
      this.tickKey = key;
      const step = w1 - w0 > 60 * MIN ? 15 * MIN : 5 * MIN;
      let ticks = '';
      for (let t = w0 + step; t < w1; t += step) ticks += `<div class="t-tick" style="left:${x(t)}px"></div>`;
      this.$('.t-ticks').innerHTML = ticks;
    }
  }
}

export class LiveTV {
  constructor(app) {
    this.app = app;
    this.video = app.video;
    this.el = document.getElementById('live-ui');
    this.banner = new Banner();
    this.trick = new TrickBar();
    this.digitsEl = h('div', { class: 'digits' });
    this.upNextEl = h('div', { class: 'upnext' });
    this.radioEl = h('div', { class: 'radio-card' });
    this.wxEl = h('div', { class: 'wx' });
    this.weather = null;
    this.guide = new Guide(app, this);
    this.el.append(this.upNextEl, this.radioEl, this.wxEl, this.banner.el, this.trick.el, this.guide.el, this.digitsEl);
    this.tl = new Timeline();
    this.state = 'play';
    this.chIndex = 0;
    this.prevIndex = 0;
    this.rec = null;
    this.timers = {};
    this.digits = '';
    this.lastFrame = performance.now();
    this.lastSeek = 0;
    // real playback from the box server, or the placeholder loops (design board, ?placeholder)
    this.real = !!app.realVideo;
    this.player = new Player(this.video, this.el);
    this.forceOpen = false;
    this.bufToken = 0;      // live buffer requests; a stale reply is ignored
    this.liveBuf = null;
    this.hadBuffer = false;
    this.video.addEventListener('ended', () => this.onEnded());
    requestAnimationFrame(this.frame);
    // browsers stop animation frames in hidden tabs; keep the clock and the stream going anyway
    setInterval(() => { if (performance.now() - this.lastFrame > 400) this.tick(performance.now()); }, 250);
  }

  get channel() { return CHANNELS[this.chIndex]; }
  get isLiveChannel() { return !this.rec && this.channel.live; }
  get airing() { return airingAt(this.channel, this.tl.isLive ? this.tl.pos : Date.now()); }

  // ── tuning ──
  // Joins the program already under way; the recording reaches back to its start.
  tune(index, { banner = true } = {}) {
    const n = CHANNELS.length;
    this.rec = null;
    if (index !== this.chIndex) this.prevIndex = this.chIndex;
    this.chIndex = ((index % n) + n) % n;
    this.startMedia(this.channel.video);
    // library channels are recorded from the top of the program; live ones from now
    this.tl.live(this.channel.live ? Date.now() : airingAt(this.channel, Date.now()).start);
    try { localStorage.setItem('tivo.channel', this.channel.num); } catch { /* private mode */ }
    this.setState('play', { quiet: true });
    this.trick.hide();
    if (banner) this.showBanner('mini');
    this.updateBuffer();
  }

  // ── live TV's buffer ──
  // Live TV channels play from the server's buffer of the channel since you tuned in
  // (livebuffer.js), so they pause, rewind and replay like a TiVo's. Radio and the
  // weather channel play direct.
  bufferable(ch = this.channel) { return this.real && ch.live && !ch.radio && !ch.weather; }

  updateBuffer() {
    const token = ++this.bufToken;
    const ch = this.channel;
    this.liveBuf = null;
    if (!this.bufferable(ch)) {
      if (this.hadBuffer) fetch('api/live/stop', { method: 'POST' }).catch(() => {});
      this.hadBuffer = false;
      return;
    }
    this.hadBuffer = true;
    const id = airingAt(ch, Date.now()).key;
    fetch(`api/live?id=${encodeURIComponent(id)}`).then((r) => r.json()).then((j) => {
      if (token !== this.bufToken) return;
      if (!j.buf) { this.liveBuf = { direct: true }; return; } // no buffer: play the stream straight
      this.liveBuf = { id: `buf:${j.buf}`, start: j.start };
      this.tl.start = j.start; // rewind reaches back to here
      this.forceOpen = true;
    }).catch(() => { if (token === this.bufToken) this.liveBuf = { direct: true }; });
  }

  stopBuffer() {
    this.bufToken++;
    this.liveBuf = null;
    if (this.hadBuffer) fetch('api/live/stop', { method: 'POST' }).catch(() => {});
    this.hadBuffer = false;
  }

  get buffered() { return !!this.liveBuf && !this.liveBuf.direct; }

  startMedia(placeholder) {
    if (this.real) {
      this.player.close({ hold: true });
      this.forceOpen = true;
    } else if (!this.video.src.endsWith(placeholder)) {
      this.video.src = placeholder;
      this.video.play().catch(() => {});
    }
  }

  playRecording(rec) {
    const ch = CHANNELS.find((c) => c.call === rec.call);
    this.rec = rec;
    this.startMedia(ch ? ch.video : CHANNELS[0].video);
    // a show still recording plays up to where it's got, and keeps growing (tick)
    this.tl.recording(rec.inProgress ? Date.now() - rec.began : rec.dur * MIN);
    this.setState('play', { quiet: true });
    this.showBanner('mini');
    this.showTrick();
  }

  // ── overlays ──
  bannerInfo(chIndex = this.chIndex, t = null) {
    if (this.rec) {
      const ch = CHANNELS.find((c) => c.call === this.rec.call);
      return { ch, airing: this.rec, rec: this.rec };
    }
    const ch = CHANNELS[chIndex];
    return { ch, airing: airingAt(ch, t ?? (this.tl.isLive ? this.tl.pos : Date.now())) };
  }

  showBanner(mode, info = this.bannerInfo()) {
    this.banner.show(mode, info);
    this.arm('banner', BANNER_MS[mode], () => { this.banner.hide(); this.browse = null; });
  }

  drawTrick() { this.trick.update(this.tl, this.state, this.tl.isLive ? this.airing : null); }

  showTrick() {
    this.trick.show();
    this.drawTrick();
    if (this.state === 'play') this.arm('trick', TRICK_MS, () => this.trick.hide());
    else this.disarm('trick');
  }

  arm(name, ms, fn) {
    this.disarm(name);
    if (!this.app.frozen) this.timers[name] = setTimeout(fn, ms);
  }
  disarm(name) { clearTimeout(this.timers[name]); }

  clearOverlays() {
    this.banner.hide();
    this.browse = null;
    this.trick.hide();
    this.cancelDigits();
  }

  openGuide() { this.clearOverlays(); this.guide.open(); }
  closeGuide() { this.guide.close(); }

  // ── trickplay ──
  setState(state, { quiet = false } = {}) {
    const wasScanning = this.state !== 'play' && this.state !== 'pause';
    this.state = state;
    // leaving FF, REW or slow back to normal speed gets the falling chirp
    if (state === 'play' && wasScanning && !quiet) sfx.play('slowdown');
    const v = this.video;
    this.app.tv?.setScanning(state !== 'play'); // TiVo mutes the program while scanning
    if (this.real) {
      // scanning moved the position, so the stream reopens there (syncMedia does the rest)
      if (wasScanning && state !== 'slow') this.forceOpen = true;
    } else {
      v.playbackRate = state === 'slow' ? 0.25 : state === 'ff1' ? 3 : 1;
      if (RATES[state] === 0 || Math.abs(RATES[state]) >= 20 || state.startsWith('rew')) v.pause();
      else v.play().catch(() => {});
    }
    if (!quiet) this.showTrick();
  }

  trickKey(action) {
    const s = this.state;
    const tl = this.tl;
    // live internet channels can pause, but there's nothing recorded to scan through
    if (this.isLiveChannel && !this.buffered && ['ff', 'rew', 'slow', 'replay', 'advance'].includes(action)) {
      sfx.play('bonk');
      this.showTrick();
      return true;
    }
    switch (action) {
      case 'pause':
        this.setState(s === 'pause' ? 'play' : 'pause');
        return true;
      case 'play':
        if (OVERSHOOT[s]) tl.pos = clamp(tl.pos + OVERSHOOT[s], tl.start, tl.end);
        this.setState('play');
        return true;
      case 'ff': {
        if (tl.atEnd && tl.isLive) { sfx.play('bonk'); this.showTrick(); return true; }
        const next = s.startsWith('ff') ? `ff${(Number(s[2]) % 3) + 1}` : 'ff1';
        sfx.play(`speed${next[2]}`);
        this.setState(next);
        return true;
      }
      case 'rew': {
        if (tl.atStart) { sfx.play('bonk'); this.showTrick(); return true; }
        const next = s.startsWith('rew') ? `rew${(Number(s[3]) % 3) + 1}` : 'rew1';
        sfx.play(`speed${next[3]}`);
        this.setState(next);
        return true;
      }
      case 'slow':
        this.setState(s === 'slow' ? 'play' : 'slow');
        return true;
      case 'replay':
        if (tl.atStart) { sfx.play('bonk'); this.showTrick(); return true; }
        tl.pos = Math.max(tl.start, tl.pos - 8000);
        if (this.real) this.forceOpen = true;
        else this.seekVideo(-8);
        this.setState('play');
        return true;
      case 'advance': {
        if (tl.atEnd) { sfx.play('bonk'); this.showTrick(); return true; }
        if (tl.isLive) tl.pos = tl.end;
        else {
          const step = 15 * MIN;
          tl.pos = Math.min(tl.end, (Math.floor(tl.pos / step) + 1) * step);
        }
        if (this.real) this.forceOpen = true;
        this.setState('play');
        return true;
      }
      default: return false;
    }
  }

  seekVideo(sec) {
    const v = this.video;
    if (v.duration) v.currentTime = (((v.currentTime + sec) % v.duration) + v.duration) % v.duration;
  }

  frame = (t) => {
    this.tick(t);
    requestAnimationFrame(this.frame);
  };

  tick(t) {
    const dt = Math.min(500, t - this.lastFrame);
    this.lastFrame = t;
    if (this.app.tv?.standby) return; // the set is off: nothing plays, recordings wait
    if (this.rec?.inProgress) this.tl.end = Math.max(this.tl.end, Date.now() - this.rec.began);
    if (!this.app.frozen) {
      // while a real stream plays, the position follows the picture instead of the clock
      const want = this.real ? this.wanted() : null;
      const following = !!want && !want.live && (this.state === 'play' || this.state === 'slow') && this.player.is(want.key)
        && !this.forceOpen && !this.player.done;
      const hit = this.tl.advance(dt, following ? 0 : RATES[this.state]);
      if (following && this.player.playing) this.tl.pos = clamp(want.base + this.player.time * 1000, this.tl.start, this.tl.end);
      if (hit === 'end' && this.state.startsWith('ff')) this.setState('play');
      if (hit === 'start' && (this.state.startsWith('rew') || this.state === 'pause')) this.setState('play');
      if (hit === 'end' && !this.tl.isLive && this.state === 'play') this.setState('pause');
      const r = RATES[this.state];
      if (this.real) this.syncMedia();
      else if ((Math.abs(r) >= 20 || r < 0) && t - this.lastSeek > 150) {
        this.seekVideo((r * (t - this.lastSeek)) / 1000);
        this.lastSeek = t;
      }
      if (this.trick.on) this.drawTrick();
      this.updateUpNext();
      this.updateRadio();
      this.updateWeather();
      this.player.capEl.classList.toggle('raised', this.trick.on);
      this.player.drawCaptions((this.state === 'play' || this.state === 'slow') && !this.upNextEl.classList.contains('on'));
      if (this.banner.on && t - (this.lastBannerTick || 0) > 1000) {
        this.lastBannerTick = t;
        this.banner.$('.b-clock').textContent = clock(Date.now());
      }
    }
  }

  // What should be on screen at the current position: a stream and the second to
  // start it from (the program, or a commercial in the break after it), or null
  // for an intermission or the gap after a film on a channel without commercials.
  // The key names one continuous stream: the half-hour parts of a recording share it.
  wanted() {
    const tl = this.tl;
    if (this.rec) {
      if (tl.pos >= tl.end) return null;
      const s = streamOf(this.rec.key);
      return { id: s.id, t: s.o + tl.pos / 1000, key: `rec:${this.rec.key}`, base: -s.o * 1000 };
    }
    const a = this.airing;
    if (a?.live) {
      const b = this.liveBuf;
      if (this.bufferable() && !b) return null; // the buffer is starting
      if (!this.buffered) return { id: a.key, t: 0, key: `live:${a.key}`, live: true, base: 0 };
      // in the buffer; never ask for the last few seconds, which are still arriving
      const t = Math.max(0, Math.min(tl.pos - b.start, Date.now() - b.start - 4000)) / 1000;
      return { id: b.id, t, key: `${b.id}@${b.start}`, base: b.start };
    }
    const seg = segmentAt(this.channel, a, tl.pos);
    if (!seg) return null;
    const base = seg.start - seg.t0 * 1000;
    return { id: seg.id, t: (tl.pos - base) / 1000, key: `${seg.id}@${base}`, base, ad: !!seg.ad };
  }

  syncMedia() {
    const want = this.wanted();
    const s = this.state;
    if (!want) {
      if (!this.rec && this.bufferable() && !this.liveBuf) return; // the buffer is starting: keep holding the picture
      this.player.close();
      this.player.standby(false);
      return;
    }
    if (s === 'play' || s === 'slow') {
      // a stream that ran out before its slot ends holds on black instead of reopening
      if (this.player.is(want.key) && this.player.done && !this.forceOpen) return;
      if (this.forceOpen || !this.player.is(want.key)) {
        if (!this.player.canOpen()) return;
        this.forceOpen = false;
        this.player.open(want.id, want.t, want.key);
      } else {
        this.player.resume();
      }
      this.video.playbackRate = s === 'slow' ? 0.25 : 1;
    } else if (s === 'pause') {
      this.player.pause();
    } else {
      this.player.pause();
      this.player.still(want.id, want.t);
    }
  }

  // the file ran out (runtimes are approximate): skip to the end of its segment,
  // as far as the broadcast has got
  onEnded() {
    if (!this.real) return;
    if (this.rec) {
      this.tl.pos = this.tl.end;
      this.setState('pause');
      return;
    }
    const seg = segmentAt(this.channel, this.airing, this.tl.pos);
    if (seg) this.tl.pos = Math.min(this.tl.end, Math.max(this.tl.pos, seg.end));
  }

  // Radio stations get a station card, like the music channels on DirecTV, with the
  // song or piece when the station sends one.
  updateRadio() {
    const ch = this.rec ? null : this.channel;
    const on = !!ch?.radio;
    this.radioEl.classList.toggle('on', on);
    if (!on) { this.radioFor = null; return; }
    const p = airingAt(ch, Date.now()).program;
    if (this.radioFor !== ch) {
      this.radioFor = ch;
      this.radioEl.style.backgroundImage = `url(${background('violet')})`;
      this.radioEl.innerHTML = `
        <div class="badge">${badge()}</div>
        <div class="r-call"></div><div class="r-name"></div><div class="r-city"></div>
        <div class="r-eq">${'<i></i>'.repeat(9)}</div>
        <div class="r-label">Now playing</div><div class="r-title"></div>
        <div class="r-clock"></div>`;
      const $ = (s) => this.radioEl.querySelector(s);
      $('.r-call').textContent = ch.call.replace(/2$/, '-2');
      $('.r-name').textContent = ch.name;
      $('.r-city').textContent = `${p.city}, New Mexico`;
      $('.r-title').textContent = p.s;
      this.nowPlayingAt = 0;
    }
    const $ = (s) => this.radioEl.querySelector(s);
    $('.r-clock').textContent = clock(Date.now());
    this.radioEl.classList.toggle('paused', this.state === 'pause');
    if (performance.now() - this.nowPlayingAt > 20000) {
      this.nowPlayingAt = performance.now();
      const key = airingAt(ch, Date.now()).key;
      fetch(`api/nowplaying?id=${key}`).then((r) => r.json()).then(({ title }) => {
        if (this.radioFor !== ch) return;
        $('.r-label').style.visibility = title ? 'visible' : 'hidden';
        $('.r-title').textContent = title || p.s;
      }).catch(() => {});
    }
  }

  // The Weather Channel (and Fairway Forecast, the golf weather) draw over the music stream.
  updateWeather() {
    const ch = this.rec ? null : this.channel;
    if (!ch?.weather) {
      if (this.wxEl.classList.contains('on')) this.wxEl.classList.remove('on');
      this.weather?.reset(); // redraw on the way back, no transition
      return;
    }
    const a = airingAt(ch, Date.now());
    const Screen = a.program?.style === 'golf' ? GolfWeather : WeatherStar;
    if (!(this.weather?.constructor === Screen)) {
      this.wxEl.className = 'wx';
      this.weather = new Screen(this.wxEl);
    }
    this.weather.update(a.key, a.program, Date.now(), this.state === 'pause');
  }

  // On channels without commercials, the gap between a film's end and the next
  // half hour (or an intermission) shows an "up next" card, the way premium cable did.
  updateUpNext() {
    const a = this.tl.isLive ? this.airing : null;
    const on = !!a && !a.live && !segmentAt(this.channel, a, this.tl.pos);
    this.upNextEl.classList.toggle('on', on);
    if (!on || this.upNextFor === a) return;
    this.upNextFor = a;
    const ch = this.channel;
    const next = airingAt(ch, a.end);
    this.upNextEl.classList.toggle('has-logo', !!ch.logo);
    this.upNextEl.innerHTML = `
      ${ch.logo ? `<div class="u-logo">${logoChip(ch, 176, 88)}</div>` : ''}
      <div class="u-chan">${ch.num} ${ch.call}</div>
      <div class="u-name">${ch.logo ? `${ch.num}&nbsp;&nbsp;${ch.name}` : ch.name}</div>
      <div class="u-label">Up next</div>
      <div class="u-title"></div>
      <div class="u-time">${clock(next.start)}</div>`;
    this.upNextEl.querySelector('.u-title').textContent = next.show.title;
  }

  // ── channel entry and banner browsing ──
  // Typing a channel number: it tunes a moment after the last digit, at once after a
  // third digit or Enter, and Clear cancels it.
  digit(d) {
    this.digits = (this.digits + d).slice(-3);
    this.digitsEl.textContent = this.digits.padEnd(3, '-');
    this.digitsEl.classList.add('on');
    this.arm('digits', this.digits.length >= 3 ? 500 : 2000, () => this.commitDigits());
  }

  commitDigits() {
    this.disarm('digits');
    const i = channelIndex(this.digits);
    this.cancelDigits();
    if (i < 0) sfx.play('bonk');
    else this.tune(i);
  }

  cancelDigits() {
    this.disarm('digits');
    this.digits = '';
    this.digitsEl.classList.remove('on');
  }

  showBrowse() {
    const { ci, t } = this.browse;
    this.showBanner('mini', this.bannerInfo(ci, t));
  }

  browseKey(action) {
    const b = this.browse;
    const n = CHANNELS.length;
    const cur = airingAt(CHANNELS[b.ci], b.t);
    switch (action) {
      case 'up': b.ci = (b.ci + 1) % n; break;
      case 'down': b.ci = (b.ci - 1 + n) % n; break;
      case 'right': b.t = cur.end; break;
      case 'left':
        if (cur.start <= Date.now()) { sfx.play('bonk'); return true; }
        b.t = Math.max(Date.now(), cur.start - 1);
        break;
      case 'select':
        if (b.ci === this.chIndex && b.t <= Date.now()) { this.banner.hide(); this.browse = null; return true; }
        sfx.play('select');
        this.browse = null;
        if (cur.start > Date.now()) {
          this.banner.hide();
          this.app.showProgram(CHANNELS[b.ci], cur);
        } else {
          this.tune(b.ci);
        }
        return true;
    }
    sfx.play('updown');
    this.showBrowse();
    return true;
  }

  rate(up) {
    const s = (this.rec || this.airing).show;
    s.thumbs = clamp((s.thumbs || 0) + (up ? 1 : -1), -3, 3);
    sfx.play(up ? 'thumbsup' : 'thumbsdown');
    this.showBanner(this.banner.mode || 'mini');
  }

  onKey(action) {
    if (this.guide.on) return this.guide.onKey(action);
    if (/^\d$/.test(action)) {
      if (this.rec) return false;
      this.digit(action);
      return true;
    }
    if (this.browse && ['up', 'down', 'left', 'right', 'select'].includes(action)) return this.browseKey(action);
    switch (action) {
      case 'chup': case 'chdown':
        if (this.rec) return false;
        this.tune(this.chIndex + (action === 'chup' ? 1 : -1));
        return true;
      case 'enter':
        if (this.digits) { this.commitDigits(); return true; } // Enter tunes a typed number now
        if (this.rec) return false;
        this.tune(this.prevIndex); // otherwise it's Last: back to the previous channel
        return true;
      case 'info':
        if (this.banner.mode === 'full') { this.banner.hide(); this.browse = null; }
        else this.showBanner('full');
        return true;
      case 'select':
        this.showBanner('mini');
        return true;
      case 'up': case 'down': case 'left': case 'right':
        if (this.rec) return false;
        this.browse = { ci: this.chIndex, t: Date.now() };
        return this.browseKey(action);
      case 'clear':
        this.cancelDigits();
        this.clearOverlays();
        return true;
      case 'back':
        // close whatever is showing; from a recording, back out to Now Playing
        if (this.banner.on || this.trick.on || this.digitsEl.classList.contains('on')) {
          this.clearOverlays();
          sfx.play('back');
          return true;
        }
        if (this.rec) {
          this.setState('pause', { quiet: true });
          sfx.play('back');
          this.app.showNowPlaying();
          return true;
        }
        return false;
      case 'thumbsup': case 'thumbsdown':
        this.rate(action === 'thumbsup');
        return true;
      case 'record': {
        // only the live channels record; the library channels are always recorded anyway
        if (this.rec || !recordable(this.channel)) return false;
        const a = this.airing;
        if (!a) return false;
        sfx.play('select');
        toggleRecording(this.channel, a).then((r) => {
          if (r.error) sfx.play('bonk'); // both tuners busy, or the media folder is away
          this.showBanner(this.banner.mode || 'mini');
        });
        this.showBanner(this.banner.mode || 'mini');
        return true;
      }
      default:
        return this.trickKey(action);
    }
  }
}
