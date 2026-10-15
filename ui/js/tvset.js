// The buttons on the peanut that talk to the TV rather than the TiVo: TV Power,
// TV Input, Volume and Mute, plus Window (the TiVo's aspect button). They act the way
// a 2003 TV would, with a green on-screen display like a Trinitron's. Power puts the
// box in standby (black, nothing streaming); any button wakes it.
import * as sfx from './sound.js';

const STEPS = 40; // TV volume runs 0-40
const OSD_MS = 3000;

export class TVSet {
  constructor(app, stage) {
    this.app = app;
    this.level = load('tv.volume', 30);
    this.muted = false;
    this.scanning = false;
    this.standby = false;
    this.input = 1;
    this.zoom = load('tv.zoom', 0) === 1;
    this.stage = stage;
    this.blueEl = el(stage, 'tv-blue');
    this.blackEl = el(stage, 'tv-standby');
    this.osdEl = el(stage, 'tv-osd');
    this.muteEl = el(stage, 'tv-mute');
    this.muteEl.textContent = 'MUTING';
    stage.classList.toggle('zoom', this.zoom);
    this.apply();
  }

  // what the speaker should be doing right now
  apply() {
    const silent = this.muted || this.standby || this.input !== 1;
    this.app.video.volume = silent || this.scanning ? 0 : this.level / STEPS;
    sfx.setVolume(silent ? 0 : this.level / STEPS);
    this.muteEl.classList.toggle('on', this.muted && !this.standby);
  }

  // TiVo mutes the program while scanning (FF, rewind, slow)
  setScanning(on) { this.scanning = on; this.apply(); }

  power() {
    this.standby = !this.standby;
    this.blackEl.classList.toggle('on', this.standby);
    this.osdEl.classList.remove('on');
    if (this.standby) {
      this.app.live.player.close();
      this.app.live.stopBuffer();
    } else {
      // back on: rejoin live TV where the broadcast is now (a paused recording waits)
      const live = this.app.live;
      if (live.rec) live.forceOpen = true;
      else live.tune(live.chIndex, { banner: !this.app.top });
    }
    this.apply();
  }

  // TV Input: over to the TV's other input (a blue screen) and back
  toggleInput() {
    this.input = this.input === 1 ? 2 : 1;
    this.blueEl.classList.toggle('on', this.input === 2);
    this.show(`VIDEO ${this.input}`);
    this.apply();
  }

  // a TiVo button while the TV is on the other input brings the box back
  backToBox() {
    if (this.input !== 1) this.toggleInput();
  }

  // Window: TiVo's aspect button. Zoom fills the 4:3 screen with a widescreen
  // picture, cropping the sides; press again for the whole picture letterboxed.
  window() {
    this.zoom = !this.zoom;
    this.stage.classList.toggle('zoom', this.zoom);
    save('tv.zoom', this.zoom ? 1 : 0);
    this.show(this.zoom ? 'ZOOM' : 'NORMAL');
  }

  mute() {
    this.muted = !this.muted;
    this.osdEl.classList.remove('on');
    this.apply();
  }

  volume(d) {
    this.muted = false;
    this.level = Math.max(0, Math.min(STEPS, this.level + d));
    save('tv.volume', this.level);
    this.apply();
    const bars = Math.round(this.level / 2);
    this.show(`<span class="v-label">VOLUME</span><span class="v-bar">${'<i></i>'.repeat(bars)}${'<b></b>'.repeat(20 - bars)}</span><span class="v-num">${this.level}</span>`, 'vol');
  }

  show(html, kind = 'label') {
    this.osdEl.className = `tv-osd on ${kind}`;
    this.osdEl.innerHTML = html;
    clearTimeout(this.osdTimer);
    this.osdTimer = setTimeout(() => this.osdEl.classList.remove('on'), OSD_MS);
  }
}

function el(parent, cls) {
  const e = document.createElement('div');
  e.className = cls;
  parent.append(e);
  return e;
}

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : Number(v); } catch { return fallback; }
}

function save(key, v) {
  try { localStorage.setItem(key, String(v)); } catch { /* private mode */ }
}
