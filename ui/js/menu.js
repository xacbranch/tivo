// The TiVo list: a glossy highlight bar that moves over the rows, hollow
// arrows hinting where you can go, and a bonk at the ends (lists don't wrap).
import { h, clamp } from './dom.js';
import { arrow } from './art.js';
import * as sfx from './sound.js';

export class Menu {
  constructor(opts) {
    Object.assign(this, {
      items: [], index: 0, offset: 0,
      top: 122, rowH: 32, visible: 9, fs: 24, textX: 118, barRight: 580, labelRight: 70,
      leftArrow: false, className: '',
      renderRow: (item) => h('span', { class: 'label' }, item.label),
      onSelect: null, onFocus: null,
    }, opts);

    this.el = h('div', { class: `menu ${this.className}` });
    const s = this.el.style;
    s.setProperty('--row-h', `${this.rowH}px`);
    s.setProperty('--fs', `${this.fs}px`);
    s.setProperty('--text-x', `${this.textX}px`);
    s.setProperty('--bar-right', `${this.barRight}px`);
    s.setProperty('--label-right', `${this.labelRight}px`);

    this.bar = h('div', {
      class: 'selbar',
      html: `${this.leftArrow ? `<span class="arrow-l">${arrow('l')}</span>` : ''}<span class="arrow-r">${arrow('r')}</span>`,
    });
    this.rowsEl = h('div');
    this.upEl = h('div', { class: 'arrow-u', html: arrow('u') });
    this.downEl = h('div', { class: 'arrow-d', html: arrow('d') });
    this.el.append(this.bar, this.rowsEl, this.upEl, this.downEl);
    this.index = clamp(this.index, 0, Math.max(0, this.items.length - 1));
    this.scrollIntoView();
    this.render();
  }

  get item() { return this.items[this.index]; }

  setItems(items, index = this.index) {
    this.items = items;
    this.index = clamp(index, 0, Math.max(0, items.length - 1));
    this.offset = clamp(this.offset, 0, Math.max(0, items.length - this.visible));
    this.scrollIntoView();
    this.render();
  }

  select(index) {
    this.index = clamp(index, 0, this.items.length - 1);
    this.scrollIntoView();
    this.render();
  }

  move(d) {
    const next = this.index + d;
    if (next < 0 || next >= this.items.length) return sfx.play('bonk');
    this.index = next;
    this.scrollIntoView();
    this.render();
    sfx.play('updown');
    this.onFocus?.(this.item);
  }

  page(d) {
    const last = this.items.length - 1;
    if ((d < 0 && this.index === 0) || (d > 0 && this.index === last)) return sfx.play('bonk');
    const maxOffset = Math.max(0, this.items.length - this.visible);
    this.offset = clamp(this.offset + d * this.visible, 0, maxOffset);
    this.index = clamp(this.index + d * this.visible, 0, last);
    this.scrollIntoView();
    this.render();
    sfx.play('updown');
    this.onFocus?.(this.item);
  }

  scrollIntoView() {
    if (this.index < this.offset) this.offset = this.index;
    if (this.index >= this.offset + this.visible) this.offset = this.index - this.visible + 1;
  }

  get hasMoreBelow() { return this.offset + this.visible < this.items.length; }

  render() {
    this.rowsEl.replaceChildren();
    const end = Math.min(this.items.length, this.offset + this.visible);
    for (let i = this.offset; i < end; i++) {
      const row = h('div', { class: 'row' }, this.renderRow(this.items[i], i === this.index));
      row.style.top = `${this.top + (i - this.offset) * this.rowH}px`;
      this.rowsEl.append(row);
    }
    const barTop = this.top + (this.index - this.offset) * this.rowH;
    this.bar.style.top = `${barTop}px`;
    this.bar.style.display = this.items.length ? '' : 'none';
    const arrowY = (this.rowH - 14) / 2;
    this.upEl.style.top = `${barTop - this.rowH + arrowY}px`;
    this.downEl.style.top = `${barTop + this.rowH + arrowY}px`;
    this.upEl.style.visibility = this.index > 0 ? 'visible' : 'hidden';
    this.downEl.style.visibility = this.index < this.items.length - 1 ? 'visible' : 'hidden';
  }

  onKey(action) {
    switch (action) {
      case 'up': this.move(-1); return true;
      case 'down': this.move(1); return true;
      case 'chup': this.page(-1); return true;
      case 'chdown': this.page(1); return true;
      case 'select':
      case 'right':
        if (!this.item || !this.onSelect) { sfx.play('bonk'); return true; }
        this.onSelect(this.item, action);
        return true;
      default: return false;
    }
  }
}
