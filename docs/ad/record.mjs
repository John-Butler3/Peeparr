// Records Peeparr on a desktop and a phone, going through one journey: sign in,
// find a scene, request it, follow the download, then watch it. Peeparr runs
// for real against a stand-in server (no Stash or Whisparr): its answers move on
// as the script goes. Frames are kept with their times, plus where each step
// starts and where each tap or click lands.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const DIST = process.env.DIST ?? '/app/apps/sp-web/dist/sp-web/browser';
const OUT = process.env.OUT ?? '/work/rec';
const M = '/work/m';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const titles = ['Sunset Rooftop Session', 'Weekend Getaway, Chapter One', 'Lakeside Afternoon', 'City Lights After Dark', 'Morning Coffee Routine', 'Beach House, Part Two', 'Behind the Scenes', 'Road Trip Diaries', 'Late Night Lounge', 'Golden Hour by the Pool', 'Mountain Cabin Weekend', 'Rainy Day Indoors'];
const studios = ['Anchor Studios', 'Coastline', 'Metro Media', 'Bluebird'];
const people = ['Anna Example', 'Dana Other', 'Mia Third', 'Lena Long', 'Sara North', 'Ivy Stone'];
const TARGET = 'c2'; // "Lakeside Afternoon"
const TARGET_LOCAL = '120';

function server(state) {
  const img = (k) => `/m/s${k % 12}.jpg`;
  const sceneCard = (i, extra = {}) => ({ id: 'c' + i, title: titles[i % 12], description: 'An easy-going shoot with plenty of natural light. '.repeat(3), imageUrl: img(i), cardImageUrl: img(i), studioId: 'st' + (i % 4), studio: studios[i % 4], studioImageUrl: `/m/logo${i % 4}.svg`, releaseDate: `2026-0${(i % 9) + 1}-1${i % 9}`, duration: 1500 + i * 211, type: 'SCENE', source: 'TPDB', status: { state: 'NOT_REQUESTED' }, requestable: true, ...extra });
  const libCard = (i, extra = {}) => ({ id: String(100 + i), activeCatalogSceneId: 'c' + i, title: titles[i % 12], description: null, imageUrl: img(i), cardImageUrl: img(i), studioId: String(i % 4), studio: studios[i % 4], studioImageUrl: `/m/logo${i % 4}.svg`, performerNames: [people[i % 6]], releaseDate: '2026-02-11', duration: 1500 + i * 211, localCreatedAt: null, type: 'SCENE', source: 'STASH', status: { state: 'AVAILABLE' }, requestable: false, viewUrl: 'x', progressPercent: null, ...extra });
  const target = () => state.target;
  const targetCard = () => sceneCard(2, { status: { state: target() }, requestable: target() === 'NOT_REQUESTED' });
  const details = (id) => {
    const i = parseInt(id.slice(1), 10) || 0;
    const st = id === TARGET ? target() : 'AVAILABLE';
    return { ...sceneCard(i), id, status: { state: st }, images: [], studioIsFavorite: false, studioUrl: null, tags: ['Outdoor', 'Lake', 'Summer', 'Golden hour'].map((n, k) => ({ id: 't' + k, name: n, description: null })), performers: [0, 1].map((k) => ({ id: 'p' + k, name: people[k], gender: 'FEMALE', isFavorite: k === 0, imageUrl: `/m/face${k}.svg`, cardImageUrl: null })), sourceUrls: [], stash: st === 'AVAILABLE' ? { exists: true, hasMultipleCopies: false, copies: [{ id: id === TARGET ? TARGET_LOCAL : String(100 + i), viewUrl: 'x', width: 1920, height: 1080, label: '1080p' }] } : null, whisparr: st === 'NOT_REQUESTED' ? null : { exists: true, viewUrl: 'x' }, markers: [] };
  };
  const page = (items) => ({ total: items.length, page: 1, perPage: 24, hasMore: false, items });
  const lifecycleItems = (lc) => {
    const t = target();
    const all = [
      ...(t !== 'AVAILABLE' && t !== 'NOT_REQUESTED' ? [{ ...targetCard(), queueStatus: state.queue, queueState: null, errorMessage: null, whisparrViewUrl: 'x' }] : []),
      { ...sceneCard(8, { status: { state: 'REQUESTED' } }), queueStatus: null, queueState: null, errorMessage: null, whisparrViewUrl: 'x' },
    ];
    return all.filter((x) => !lc || lc === 'ANY' || x.status.state === lc);
  };
  const counts = () => { const c = { REQUESTED: 0, DOWNLOADING: 0, IMPORT_PENDING: 0, FAILED: 0 }; for (const x of lifecycleItems()) c[x.status.state] = (c[x.status.state] ?? 0) + 1; return c; };
  const svg = (body, w = 600, h = 600) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`;
  const face = (k) => svg(`<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${['#d94f6f', '#3fb8c4', '#f2a541', '#9d6bff', '#7bd389', '#ff7a59'][k % 6]}"/><stop offset="1" stop-color="#1a1a22"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/><circle cx="300" cy="250" r="110" fill="rgba(255,255,255,.22)"/><rect x="140" y="390" width="320" height="260" rx="160" fill="rgba(255,255,255,.22)"/>`);
  const logo = (k) => svg(`<text x="20" y="90" font-family="DejaVu Sans" font-weight="700" font-size="70" fill="${['#ffffff', '#ffd166', '#8be9fd', '#ff79c6'][k]}">${studios[k].split(' ')[0].toUpperCase()}</text>`, 520, 120);

  return (req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const send = (body, type = 'application/json', status = 200) => { res.writeHead(status, { 'content-type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
    if (p === '/blank') return send('<html style="background:#0f0f0f"></html>', 'text/html');
    if (p.startsWith('/m/')) {
      const n = p.slice(3);
      if (n.startsWith('s')) return send(fs.readFileSync(path.join(M, n)), 'image/jpeg');
      if (n.startsWith('logo')) return send(logo(parseInt(n.replace(/\D/g, ''), 10) % 4), 'image/svg+xml');
      return send(face(parseInt(n.replace(/\D/g, '') || '0', 10)), 'image/svg+xml');
    }
    let m;
    if ((m = p.match(/^\/api\/media\/stash\/scenes\/(\d+)\/(preview|stream)$/))) { const k = parseInt(m[1], 10) % 12; return send(fs.readFileSync(path.join(M, `v${k}.webm`)), 'video/webm'); }
    if ((m = p.match(/^\/api\/media\/stash\/\w+\/(\d+)\/(screenshot|photo|logo|cover)$/))) return send(fs.readFileSync(path.join(M, `s${parseInt(m[1], 10) % 12}.jpg`)), 'image/jpeg');
    if (p === '/api/auth/status') return send({ bootstrapRequired: false, authenticated: state.authed, username: state.authed ? 'admin' : null });
    if (p === '/api/auth/login') { state.authed = true; return send({ bootstrapRequired: false, authenticated: true, username: 'admin' }); }
    if (p === '/api/setup/status') return send({ setupComplete: true, required: { stash: true, catalog: true, whisparr: true }, catalogProvider: 'TPDB' });
    if (p === '/api/settings/preferences') return send({ hideAmateurNetworkResults: false, defaultRootFolderPath: '/data/scenes', defaultQualityProfileId: 2, defaultMonitored: true, defaultSearchForMovie: true, defaultTagIds: [], streamFromPornhub: false });
    if (p === '/api/home/hero') return send({ items: [0, 4, 9].map((i) => ({ ...libCard(i), heroReason: i === 0 ? 'NEW' : 'UNWATCHED' })) });
    if (p === '/api/home/continue-watching') return send({ items: [...(state.watched ? [libCard(2, { id: TARGET_LOCAL, progressPercent: 18 })] : []), libCard(5, { progressPercent: 42 }), libCard(7, { progressPercent: 70 })], message: null });
    if (p === '/api/home/recently-added') return send({ items: [...(target() === 'AVAILABLE' ? [libCard(2, { id: TARGET_LOCAL })] : []), ...[3, 6, 10, 11].map((i) => libCard(i))], message: null });
    if (p === '/api/home/watch-progress') return send({ items: [{ id: '105', activeCatalogSceneId: 'c5', progressPercent: 42 }, { id: '107', activeCatalogSceneId: 'c7', progressPercent: 70 }, ...(state.watched ? [{ id: TARGET_LOCAL, activeCatalogSceneId: TARGET, progressPercent: 18 }] : [])] });
    if (p === '/api/home/rails') return send([]);
    if (p === '/api/scenes/popular') return send(page([1, 2, 3, 4, 5, 6, 7, 8].map((i) => (i === 2 ? targetCard() : sceneCard(i)))));
    if (p === '/api/scenes') { const q = (u.searchParams.get('titleQuery') ?? u.searchParams.get('name') ?? '').toLowerCase(); const items = [...Array(12).keys()].map((i) => (i === 2 ? targetCard() : sceneCard(i))).filter((s) => !q || s.title.toLowerCase().includes(q)); return send(page(items)); }
    if (p === '/api/performers/popular' || p === '/api/performers') { const q = (u.searchParams.get('name') ?? '').toLowerCase(); return send(page(people.map((n, k) => ({ id: 'p' + k, name: n, gender: 'FEMALE', sceneCount: 40 - k * 5, isFavorite: k === 0, imageUrl: `/m/face${k}.svg`, cardImageUrl: `/m/face${k}.svg` })).filter((x) => !q || x.name.toLowerCase().includes(q)))); }
    if (p === '/api/studios/popular' || p === '/api/studios') { const q = (u.searchParams.get('name') ?? '').toLowerCase(); return send(page(studios.map((n, k) => ({ id: 'st' + k, name: n, isFavorite: false, imageUrl: `/m/logo${k}.svg`, cardImageUrl: `/m/logo${k}.svg`, parentStudio: null, childStudios: [] })).filter((x) => !q || x.name.toLowerCase().includes(q)))); }
    if ((m = p.match(/^\/api\/scenes\/(c\d+)\/similar$/))) return send({ items: [4, 6, 9, 11].map((i) => sceneCard(i, { status: { state: 'AVAILABLE' }, requestable: false })) });
    if ((m = p.match(/^\/api\/scenes\/(c\d+)\/stream$/))) { const local = m[1] === TARGET ? TARGET_LOCAL : String(100 + parseInt(m[1].slice(1), 10)); return send({ stashSceneId: local, streamUrl: `/api/media/stash/scenes/${local}/stream`, duration: 1600, resumeSeconds: 0 }); }
    if ((m = p.match(/^\/api\/scenes\/(c\d+)$/))) return send(details(m[1]));
    if ((m = p.match(/^\/api\/requests\/(c\d+)$/)) && req.method === 'POST') { if (m[1] === TARGET) state.target = 'REQUESTED'; return send({ stashId: m[1], whisparrMovieId: 1 }); }
    if (p === '/api/acquisition/scenes') { const lc = u.searchParams.get('lifecycle'); const items = lifecycleItems(lc); return send({ total: items.length, page: 1, perPage: 24, hasMore: false, countsByLifecycle: counts(), items }); }
    if ((m = p.match(/^\/api\/media\/stash\/scenes\/(\d+)\/playback-info$/))) return send({ resumeSeconds: 0, duration: 1600, height: 1080, streamToken: null });
    if ((m = p.match(/^\/api\/media\/stash\/scenes\/(\d+)\/markers$/))) return send({ markers: [{ seconds: 0, title: 'Arrival' }, { seconds: 240, title: 'By the water' }, { seconds: 610, title: 'Golden hour' }, { seconds: 980, title: 'Evening' }] });
    if ((m = p.match(/^\/api\/media\/stash\/scenes\/(\d+)\/progress$/))) { if (m[1] === TARGET_LOCAL) state.watched = true; return send(null); }
    if (p === '/api/library/unplayed' || p === '/api/library/similar') return send({ items: [3, 6, 10, 11].map((i) => libCard(i)) });
    if (p === '/api/library/scenes') return send({ ...page([2, 3, 6, 10, 11].map((i) => libCard(i, i === 2 ? { id: TARGET_LOCAL } : {}))), latestSyncAt: null });
    if (p === '/api/performers/p0') return send({ id: 'p0', name: people[0], disambiguation: null, aliases: [], gender: 'FEMALE', birthDate: null, deathDate: null, age: 27, ethnicity: null, country: 'AU', eyeColor: null, hairColor: null, height: null, cupSize: null, bandSize: null, waistSize: null, hipSize: null, breastType: null, careerStartYear: 2019, careerEndYear: null, deleted: false, mergedIds: [], mergedIntoId: null, isFavorite: true, createdAt: null, updatedAt: null, imageUrl: '/m/face0.svg', images: [0, 1, 2].map((k) => ({ id: 'i' + k, url: `/m/face${k}.svg`, width: 600, height: 900 })) });
    if (p === '/api/performers/p0/scenes') return send(page([0, 3, 5, 9, 2, 11].map((i) => (i === 2 ? targetCard() : sceneCard(i, { status: { state: 'AVAILABLE' }, requestable: false })))));
    if (p === '/api/performers/p0/monitoring') return send({ monitored: false, monitoredSince: null });
    if (p.startsWith('/api/')) return send(p.endsWith('s') ? page([]) : {});
    // The app itself.
    let file = path.join(DIST, p === '/' ? 'index.html' : p);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/json', '.ico': 'image/x-icon' };
    send(fs.readFileSync(file), types[path.extname(file)] ?? 'application/octet-stream');
  };
}

const DEVICES = {
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

async function run(name) {
  const state = { authed: false, target: 'NOT_REQUESTED', queue: null, watched: false };
  const srv = http.createServer(server(state));
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const phone = name === 'phone';
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium-browser', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'] });
  const ctx = await browser.newContext(DEVICES[name]);
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => console.log(name, 'PAGE ERROR', e.message));
  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  await pg.goto('about:blank');
  let cdp = null;
  let n = 0;
  const attach = async () => {
  cdp = await ctx.newCDPSession(pg);
  cdp.on('Page.screencastFrame', (f) => {
    const file = String(n++).padStart(5, '0') + '.jpg';
    fs.writeFileSync(path.join(dir, file), Buffer.from(f.data, 'base64'));
    frames.push({ t: f.metadata.timestamp, file });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  };
  const steps = [];
  const taps = [];
  const now = () => Date.now() / 1000;
  const step = (id) => steps.push({ id, t: now() });
  const centre = async (sel) => { const el = pg.locator(sel).first(); await el.waitFor({ state: 'visible', timeout: 8000 }); await el.scrollIntoViewIfNeeded({ timeout: 800 }).catch(() => {}); const b = await el.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const tap = async (sel) => {
    let at;
    try { at = await centre(sel); } catch (error) { await pg.screenshot({ path: path.join(OUT, `${name}-missing-${steps.at(-1)?.id}-${taps.length}.png`) }); console.log(name, 'MISSING', sel, steps.at(-1)?.id); return; }
    const { x, y } = at;
    if (phone) { taps.push({ x, y, t: now() }); await pg.touchscreen.tap(x, y); }
    else { await pg.mouse.move(x, y, { steps: 18 }); await wait(160); taps.push({ x, y, t: now() }); await pg.mouse.click(x, y); }
  };
  const type = async (text) => { for (const ch of text) { await pg.keyboard.type(ch); await wait(115); } };
  const scrollTo = (y, ms = 900) => pg.evaluate(([y, ms]) => new Promise((done) => { const s = scrollY, t0 = performance.now(); const f = () => { const k = Math.min(1, (performance.now() - t0) / ms); const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; scrollTo(0, s + (y - s) * e); k < 1 ? requestAnimationFrame(f) : done(); }; requestAnimationFrame(f); }), [y, ms]);
  const nav = async (href) => {
    // A toast over it goes first; on a phone the bars come back with a little scroll up.
    const close = pg.locator('.p-toast-close-button').first();
    if (await close.isVisible().catch(() => false)) { await tap('.p-toast-close-button'); await wait(500); }
    if (phone) { await pg.evaluate(() => scrollBy({ top: -160, behavior: 'smooth' })); await wait(600); }
    await tap(phone ? `.mobile-nav a[href="${href}"], nav a[href="${href}"]` : `a.nav-item[href="${href}"]`);
  };

  // (Started on a page of the same site: the recording carries on through.)
  await pg.goto(base + '/blank');
  await attach();
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 });
  await pg.goto(base + '/login', { waitUntil: 'commit' });
  if (!phone) await pg.mouse.move(900, 520);

  step('signin');
  await wait(2700);
  await tap('input[formcontrolname="username"]'); await type('admin');
  await tap('input[formcontrolname="password"]'); await type('peeparr!');
  await wait(250);
  await tap('form button[type="submit"]');
  await wait(3600);

  step('home');
  await wait(2200);
  await scrollTo(phone ? 560 : 520, 1100);
  await wait(500);
  if (!phone) {
    const card = await centre('section.rail-section app-scene-card .media');
    await pg.mouse.move(card.x, card.y - 10, { steps: 22 });
  }
  await wait(3200);
  await scrollTo(0, 800);
  await wait(500);

  step('search');
  if (phone) await tap('.masthead-icon[aria-label="Search"]');
  else await tap('.masthead-search-input');
  await wait(300);
  await type('lake');
  await wait(1500);
  await tap(`.suggest a[href*="/scene/${TARGET}"], main a[href*="/scene/${TARGET}"]`);
  await wait(2300);

  step('request');
  await scrollTo(phone ? 160 : 120, 700);
  await wait(900);
  await tap('.watch-title-row .watch-title-action');
  await wait(2600);

  step('download');
  await nav('/acquisition');
  await wait(2200);
  state.target = 'DOWNLOADING'; state.queue = 'Downloading · 38%';
  await tap('[data-testid="summary-card-DOWNLOADING"]');
  if (phone) { await wait(500); await scrollTo(760, 900); }
  await wait(1500);
  state.queue = 'Downloading · 91%';
  if (phone) { await scrollTo(0, 600); await wait(300); }
  await tap('[data-testid="summary-card-DOWNLOADING"]'); await wait(200);
  await tap('[data-testid="summary-card-DOWNLOADING"]');
  if (phone) { await wait(500); await scrollTo(760, 900); }
  await wait(1700);
  state.target = 'IMPORT_PENDING'; state.queue = 'Importing into Stash';
  if (phone) { await scrollTo(0, 600); await wait(300); }
  await tap('[data-testid="summary-card-IMPORT_PENDING"]');
  if (phone) { await wait(500); await scrollTo(760, 900); }
  await wait(1500);
  state.target = 'AVAILABLE'; state.queue = null;

  step('library');
  await nav('/home');
  await wait(1800);
  await scrollTo(phone ? 560 : 470, 900);
  await wait(1200);
  await tap(`section.rail-section a[href*="/scene/${TARGET}"]`);
  await wait(1200);

  step('preview');
  await wait(5600);

  step('watch');
  await tap('[data-testid="inline-player-poster"]');
  await wait(2600);
  if (!phone) { await tap('app-playback-menu button'); await wait(1600); await tap('app-playback-menu button'); await wait(400); }
  await tap('.chapter >> nth=2');
  await wait(2200);

  step('keep');
  await nav('/home');
  await wait(3800);

  step('explore');
  await scrollTo(phone ? 1300 : 1150, 1200);
  await wait(800);
  await tap('a[href="/performer/p0"]').catch(() => {});
  await wait(2000);
  await scrollTo(phone ? 420 : 380, 1000);
  await wait(1800);

  step('end');
  await cdp.send('Page.stopScreencast');
  await wait(300);
  fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify({ frames, steps, taps, viewport: DEVICES[name].viewport, scale: DEVICES[name].deviceScaleFactor }));
  console.log(name, 'frames', frames.length, 'steps', steps.map((s) => `${s.id}:${(s.t - steps[0].t).toFixed(1)}`).join(' '));
  await browser.close();
  srv.close();
}

await Promise.all([run('desktop'), run('phone')]);
