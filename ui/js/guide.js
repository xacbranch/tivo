// Grid guide, drawn over live TV: description box up top, 90 minutes across,
// eight channels down, the selected show lit up in gold.
import { h } from './dom.js';
import { badge, dot, logoChip } from './art.js';
import { CHANNELS, airingAt, channelIndex } from './data.js';
import { recordable, toggleRecording } from './dvr.js';
import { HALF, clock, dayDate, range, floorHalf } from './time.js';
import { describe } from './screens.js';
import * as sfx from './sound.js';

const ROWS = 8;
const ROW_PITCH = 27;
const CHAN_W = 115;          // channel column, incl. gap
const GRID_W = 528;          // .g-rows width
const SLOTS = 3;
const SLOT_W = (GRID_W - CHAN_W) / SLOTS;

export class Guide {
  constructor(app, live) {
    this.app = app;
    this.live = live;
    this.el = h('div', { class: 'guide' });
    this.on = false;
  }

  open() {
    const now = Date.now();
    this.on = true;
    this.winStart = floorHalf(now);
    this.row = this.live.chIndex;
    this.top = CHANNELS.length <= ROWS ? 0 : Math.max(0, this.row - 2);
    this.focusTime = now;
    this.render();
    this.el.classList.add('on');
    // keep the time bar and the clock moving while the guide is up
    clearInterval(this.ticker);
    this.ticker = setInterval(() => this.tick(), 15e3);
  }

  close() { this.on = false; this.el.classList.remove('on'); this.cancelDigits(); clearInterval(this.ticker); }

  // a half hour gone by: the grid rolls forward, unless it's been scrolled ahead
  tick() {
    const now = Date.now();
    if (floorHalf(now) > this.winStart) {
      this.winStart = floorHalf(now);
      this.focusTime = Math.max(this.focusTime, now);
    }
    this.render();
  }

  get winEnd() { return this.winStart + SLOTS * HALF; }
  get channel() { return CHANNELS[this.row]; }
  get focused() { return airingAt(this.channel, Math.max(this.focusTime, this.winStart)); }

  render() {
    const now = Date.now();
    const live = this.live;
    const liveCh = live.channel;
    const f = this.focused;
    const s = f.show;
    const x = (t) => CHAN_W + ((t - this.winStart) / HALF) * SLOT_W;

    let head = `<div style="left:0;width:112px">${dayDate(this.winStart)}</div>`;
    for (let i = 0; i < SLOTS; i++) {
      const left = CHAN_W + i * SLOT_W;
      head += `<div class="sep" style="left:${left - 2}px"></div><div style="left:${left}px;width:${SLOT_W}px">${clock(this.winStart + i * HALF)}</div>`;
    }

    let rows = '';
    const n = Math.min(ROWS, CHANNELS.length);
    // the half hour under way fills like a progress bar: the part gone by darker
    if (now >= this.winStart && now < this.winStart + HALF) {
      head = `<div class="elapsed" style="left:${CHAN_W}px;width:${Math.round(x(now) - CHAN_W)}px"></div>` + head;
    }
    for (let r = 0; r < n; r++) {
      const ci = (this.top + r) % CHANNELS.length;
      const ch = CHANNELS[ci];
      const y = r * ROW_PITCH;
      const call = ch.logo ? `<span class="c lg">${logoChip(ch, 54, 19)}</span>` : `<span class="c">${ch.call}</span>`;
      rows += `<div class="g-chan" style="top:${y}px"><span class="n">${ch.num}</span>${call}</div>`;
      for (const a of ch.airings) {
        if (a.end <= this.winStart || a.start >= this.winEnd) continue;
        const l = x(Math.max(a.start, this.winStart));
        const w = x(Math.min(a.end, this.winEnd)) - l - 2;
        const sel = ci === this.row && a === f;
        const cl = a.start < this.winStart ? '<span class="cl">‹</span>' : '';
        const cr = a.end > this.winEnd ? '<span class="cr">›</span>' : '';
        const rec = a.recording ? `<span class="rec">${dot('red', 12)}</span>` : '';
        rows += `<div class="g-cell${sel ? ' sel' : ''}" style="top:${y}px;left:${l + 1}px;width:${w}px">${cl}${rec}${escape(a.show.title)}${cr}</div>`;
      }
    }

    const liveAiring = airingAt(liveCh, now);
    this.el.innerHTML = `
      <div class="g-tab"></div>
      <div class="g-frame"></div>
      <div class="g-badge">${badge()}</div>
      <div class="g-tabtext">Live Guide</div>
      <div class="g-now">${liveCh.num} ${liveCh.call}&nbsp;&nbsp;&nbsp;${clock(now)}<br>${escape(liveAiring.show.title)}</div>
      <div class="g-desc">
        <div class="t1">${escape(s.title)}${s.movie ? ` (${s.year})` : ''}</div>
        <div class="t2">${dayDate(f.start)}&nbsp;&nbsp;${range(f.start, f.end)}&nbsp;&nbsp;&nbsp;${this.channel.num} ${this.channel.call}&nbsp;&nbsp;&nbsp;${s.rating}</div>
        <div class="t3">${escape(describe(f))}</div>
      </div>
      <div class="g-head">${head}</div>
      <div class="g-rows">${rows}</div>
      <div class="g-foot">Press ENTER for Guide Options:      All Chans / No Filter</div>`;
  }

  moveRow(d) {
    const n = CHANNELS.length;
    this.row = (this.row + d + n) % n;
    if (n > ROWS) {
      const r = (this.row - this.top + n) % n;
      if (r >= ROWS) this.top = d > 0 ? (this.row - ROWS + 1 + n) % n : this.row;
    }
  }

  // Typing a channel number in the guide jumps the grid to that channel.
  digit(d) {
    const box = this.live.digitsEl;
    this.digits = ((this.digits || '') + d).slice(-3);
    box.textContent = this.digits.padEnd(3, '-');
    box.classList.add('on');
    clearTimeout(this.digitTimer);
    this.digitTimer = setTimeout(() => this.commitDigits(), this.digits.length >= 3 ? 500 : 2000);
  }

  commitDigits() {
    const i = channelIndex(this.digits);
    this.cancelDigits();
    if (!this.on) return;
    if (i < 0) { sfx.play('bonk'); return; }
    sfx.play('updown');
    this.row = i;
    this.top = CHANNELS.length <= ROWS ? 0 : Math.max(0, i - 2);
    this.focusTime = Date.now();
    this.render();
  }

  cancelDigits() {
    clearTimeout(this.digitTimer);
    this.digits = '';
    this.live.digitsEl.classList.remove('on');
  }

  onKey(action) {
    if (/^\d$/.test(action)) { this.digit(action); return true; }
    if (this.digits && action === 'enter') { this.commitDigits(); return true; }
    if (this.digits && action === 'clear') { this.cancelDigits(); return true; }
    const now = Date.now();
    const f = this.focused;
    const airings = this.channel.airings;
    const i = airings.indexOf(f);
    switch (action) {
      case 'up': case 'down':
        this.moveRow(action === 'up' ? -1 : 1);
        break;
      case 'chup': case 'chdown':
        for (let k = 0; k < ROWS; k++) this.moveRow(action === 'chup' ? -1 : 1);
        break;
      case 'right': {
        const next = airings[i + 1];
        if (!next) { sfx.play('bonk'); return true; }
        while (next.start >= this.winEnd) this.winStart += HALF;
        this.focusTime = Math.max(next.start, this.winStart);
        break;
      }
      case 'left': {
        const prev = airings[i - 1];
        if (!prev || prev.end <= now) { sfx.play('bonk'); return true; }
        if (prev.start < this.winStart) this.winStart = Math.max(floorHalf(now), floorHalf(prev.start));
        this.focusTime = Math.max(prev.start, this.winStart, now);
        break;
      }
      case 'select':
        sfx.play('select');
        if (f.start <= now && now < f.end) {
          this.close();
          this.live.tune(this.row);
        } else {
          this.app.showProgram(this.channel, f);
        }
        return true;
      case 'record': {
        // live channels record (now, or when it airs); library channels already are
        if (!recordable(this.channel) || f.end <= now) { sfx.play('bonk'); return true; }
        sfx.play('select');
        toggleRecording(this.channel, f).then((r) => { if (r.error) sfx.play('bonk'); if (this.on) this.render(); });
        this.render();
        return true;
      }
      case 'thumbsup': case 'thumbsdown':
        f.show.thumbs = (f.show.thumbs || 0) + (action === 'thumbsup' ? 1 : -1);
        sfx.play(action);
        return true;
      case 'info':
        sfx.play('select');
        this.app.showProgram(this.channel, f);
        return true;
      case 'back':
        sfx.play('back');
        this.close();
        return true;
      case 'clear':
        this.close();
        return true;
      default:
        return false;
    }
    sfx.play('updown');
    this.render();
    return true;
  }
}

function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
