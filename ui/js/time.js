// TiVo-style time formatting: "4:30 pm", "Sat 7/21", "1 hour, 45 minutes".
export const MIN = 60e3;
export const HALF = 30 * MIN;
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parts = (t) => {
  const d = new Date(t);
  const h = d.getHours();
  return { h12: h % 12 || 12, m: String(d.getMinutes()).padStart(2, '0'), ap: h < 12 ? 'am' : 'pm' };
};

export const clock = (t) => { const p = parts(t); return `${p.h12}:${p.m} ${p.ap}`; };
export const hm = (t) => { const p = parts(t); return `${p.h12}:${p.m}`; };
export const dayDate = (t) => { const d = new Date(t); return `${DAYS[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`; };
export const day = (t) => DAYS[new Date(t).getDay()];
export const mdate = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };

// "4:30 - 5:00 pm", or "11:30 am - 12:00 pm" when the meridiem changes
export function range(a, b) {
  const pa = parts(a), pb = parts(b);
  return pa.ap === pb.ap ? `${pa.h12}:${pa.m} - ${clock(b)}` : `${clock(a)} - ${clock(b)}`;
}

export function duration(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  const out = [];
  if (h) out.push(`${h} hour${h > 1 ? 's' : ''}`);
  if (m || !h) out.push(`${m} minute${m === 1 ? '' : 's'}`);
  return out.join(', ');
}

// "1:18" / "0:07" style elapsed time for recordings
export function elapsed(ms) {
  const total = Math.max(0, Math.floor(ms / MIN));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export const floorHalf = (t) => Math.floor(t / HALF) * HALF;
