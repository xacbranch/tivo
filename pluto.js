// Pluto TV streams. Pluto's web player starts a session first (boot.pluto.tv), which
// hands back a token, the stream server to use and its parameters. A stream link
// built without one now gets a "Pluto TV is no longer available on this device"
// slate. A session lasts about eight hours and works for every channel, so one is
// reused until it's due for a refresh.
import crypto from 'node:crypto';

const BOOT = 'https://boot.pluto.tv/v4/start';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const clientID = crypto.randomUUID();
let session = null;
let starting = null;

async function start(channelId) {
  const q = new URLSearchParams({
    appName: 'web', appVersion: '9.10.0', deviceVersion: '126.0.0', deviceModel: 'web', deviceMake: 'chrome',
    deviceType: 'web', clientID, clientModelNumber: '1.0.0', channelID: channelId, serverSideAds: 'false',
    constraints: '', drmCapabilities: '', blockingMode: '',
  });
  const res = await fetch(`${BOOT}?${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`pluto session ${res.status}`);
  const b = await res.json();
  const ttl = Math.max(600, (Number(b.refreshInSec) || 3600) - 600) * 1000;
  return { until: Date.now() + ttl, stitcher: b.servers.stitcher, channels: b.servers.channels, params: b.stitcherParams,
           token: b.sessionToken };
}

async function current(channelId) {
  if (!session || Date.now() > session.until) {
    starting ||= start(channelId).finally(() => { starting = null; });
    session = await starting;
  }
  return session;
}

// The stream link for a Pluto channel id, starting a session if there isn't a fresh one.
export async function plutoUrl(channelId) {
  await current(channelId);
  return `${session.stitcher}/v2/stitch/hls/channel/${channelId}/master.m3u8?${session.params}`
    + `&jwt=${session.token}&masterJWTPassthrough=true`;
}

// What's on: each channel's programs for the next `hours`, as
// { channelId: [{ start, end, title, ep, desc }] } (times in ms).
export async function plutoGuide(channelIds, hours = 12) {
  if (!channelIds.length) return {};
  const s = await current(channelIds[0]);
  const from = new Date();
  from.setMinutes(0, 0, 0);
  const q = new URLSearchParams({ start: from.toISOString(), channelIds: channelIds.join(','), duration: String(hours * 60) });
  const res = await fetch(`${s.channels}/v2/guide/timelines?${q}`, {
    headers: { Authorization: `Bearer ${s.token}`, 'User-Agent': UA }, signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`pluto guide ${res.status}`);
  const out = {};
  for (const ch of (await res.json()).data || []) {
    out[ch.channelId] = (ch.timelines || []).map((t) => ({
      start: Date.parse(t.start), end: Date.parse(t.stop), title: t.title,
      ep: t.episode?.name && t.episode.name !== t.title ? t.episode.name : '',
      desc: (t.episode?.description || '').replace(/\s+/g, ' ').trim(),
    }));
  }
  return out;
}
