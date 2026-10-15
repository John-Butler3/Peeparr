import puppeteer from 'puppeteer-core';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
const DIST = '/dist', BASE = 'http://app.local';
const colors = ['#7a4b6b', '#4b6b7a', '#6b7a4b', '#7a5b3b', '#2b6b8a', '#5b3b7a', '#8a3b3b', '#3b8a6b', '#6b6b6b'];
const svg = (w, h, c) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="#111"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
const titles = ['Sunset Rooftop Session', 'Weekend Getaway — Chapter 1 With A Much Longer Title That Wraps', 'Lakeside Afternoon', 'City Lights After Dark', 'Morning Coffee Routine', 'Beach House Vlog Part Two', 'Studio Behind the Scenes', 'Road Trip Diaries', 'Late Night Lounge'];
const studios = ['Anchor Studios', 'Banana Films', 'Coastline', 'Metro Media'];
const lib = (i) => ({ id: String(100 + i), activeCatalogSceneId: i % 3 ? 'c' + i : null, title: titles[i % 9], description: 'A relaxed shoot. '.repeat(12), imageUrl: `/m/s${i}.svg`, cardImageUrl: `/m/s${i}.svg`, studioId: null, studio: studios[i % 4], studioImageUrl: i % 2 ? `/m/logo${i % 4}.svg` : null, performerNames: ['Anna Example', 'Dana Other'], releaseDate: `2025-0${(i % 9) + 1}-1${i % 9}`, duration: 900 + i * 377, localCreatedAt: null, type: 'SCENE', source: 'STASH', viewUrl: 'http://stash/scenes/' + (100 + i) });
const disc = (i) => ({ ...lib(i), id: 'c' + i, studioId: 'st1', status: { state: ['AVAILABLE', 'NOT_REQUESTED', 'REQUESTED', 'DOWNLOADING'][i % 4] }, requestable: i % 4 === 1, source: 'STASHDB' });
const feed = (n, f) => ({ total: n, page: 1, perPage: 24, hasMore: false, items: Array.from({ length: n }, (_, i) => f(i)) });
const sceneDetail = (id, state) => ({ id, title: 'Weekend Getaway — Chapter 1', description: 'A relaxed shoot over a long weekend by the coast, with plenty of sunshine and a slow pace throughout. '.repeat(5), imageUrl: '/m/s4.svg', images: [], studioId: 'st1', studioIsFavorite: false, studio: 'Anchor Studios', studioImageUrl: '/m/logo0.svg', studioUrl: null, releaseDate: '2025-06-11', duration: 1620, tags: ['Outdoor', 'Beach', 'Sunset', 'Vacation', 'Couple'].map((n, i) => ({ id: 't' + i, name: n, description: null })), performers: ['Anna Example', 'Dana Other', 'Mia Third'].map((n, i) => ({ id: 'p' + i, name: n, gender: 'FEMALE', isFavorite: i === 0, imageUrl: `/m/face${i}.svg`, cardImageUrl: null })), sourceUrls: [], source: 'STASHDB', status: { state }, stash: state === 'AVAILABLE' ? { exists: true, hasMultipleCopies: false, copies: [{ id: '101', viewUrl: 'http://stash/scenes/101', width: 1920, height: 1080, label: '1080p' }] } : null, whisparr: { exists: state !== 'NOT_REQUESTED', viewUrl: 'http://w/1' } });
const performer = { id: 'p1', name: 'Anna Example', disambiguation: 'Model', aliases: ['Anna E', 'A. Example'], gender: 'FEMALE', birthDate: '1996-04-01', deathDate: null, age: 29, ethnicity: 'Caucasian', country: 'US', eyeColor: 'Blue', hairColor: 'Blonde', height: '168', cupSize: 'C', bandSize: 34, waistSize: 26, hipSize: 36, breastType: 'NATURAL', careerStartYear: 2016, careerEndYear: null, deleted: false, mergedIds: [], mergedIntoId: null, isFavorite: true, createdAt: null, updatedAt: null, imageUrl: '/m/face1.svg', images: [1,2,3,4,5,6].map((n) => ({ id: 'i' + n, url: '/m/face' + n + '.svg', width: 600, height: 900 })) };
const studio = { id: 'st1', name: 'Anchor Studios', aliases: [], deleted: false, isFavorite: false, createdAt: null, updatedAt: null, imageUrl: '/m/logo0.svg', images: [{ id: 'i', url: '/m/logo0.svg', width: 300, height: 100 }], urls: [{ url: 'http://anchor', type: 'HOME', siteName: 'Home', siteUrl: null, siteIcon: null }], parentStudio: { id: 'n1', name: 'Anchor Network', aliases: [], isFavorite: false }, childStudios: [] };
const api = (u) => { const url = new URL(u); const p = url.pathname;
  if (p === '/api/auth/status') return process.env.AUTH === 'none' ? { bootstrapRequired: false, authenticated: false, username: null } : process.env.AUTH === 'bootstrap' ? { bootstrapRequired: true, authenticated: false, username: null } : { bootstrapRequired: false, authenticated: true, username: 'odd' };
  if (p === '/api/setup/status') return { setupComplete: true, required: { stash: true, catalog: true, whisparr: true }, catalogProvider: 'STASHDB' };
  if (p === '/api/home/watch-progress') return { items: [{ id: '102', activeCatalogSceneId: null, progressPercent: 35 }, { id: '104', activeCatalogSceneId: null, progressPercent: 100 }, { id: '105', activeCatalogSceneId: null, progressPercent: 70 }] };
  if (p === '/api/home/rails') return [{ id: 'r1', key: 'FAVORITE_STUDIOS', kind: 'BUILTIN', source: 'STASHDB', contentType: 'SCENES', title: 'From your favorite studios', subtitle: null, enabled: true, sortOrder: 1, editable: false, deletable: false, config: { sort: 'DATE', direction: 'DESC', favorites: 'STUDIO', tagIds: [], tagNames: [], tagMode: null, studioIds: [], studioNames: [], limit: 16 } }];
  if (p === '/api/home/rails/r1/items') return { items: Array.from({ length: 8 }, (_, i) => ({ ...disc(i), progressPercent: null })), message: null };
  if (p === '/api/home/continue-watching') return { items: Array.from({ length: 4 }, (_, i) => ({ ...lib(i), status: { state: 'AVAILABLE' }, requestable: false, progressPercent: 30 + i * 15 })), message: null };
  if (p === '/api/home/recently-added') return { items: Array.from({ length: 6 }, (_, i) => ({ ...lib(i + 2), status: { state: 'AVAILABLE' }, requestable: false, progressPercent: null })), message: null };
  if (p === '/api/scenes/popular') return feed(10, (i) => disc(i + 3));
  if (p === '/api/scenes/abc') return sceneDetail('abc', 'AVAILABLE');
  if (p === '/api/scenes/req') return sceneDetail('req', 'NOT_REQUESTED');
  if (/^\/api\/scenes\/c\d+$/.test(p)) return { ...sceneDetail(p.split('/').pop(), 'AVAILABLE'), title: 'Lakeside Afternoon', imageUrl: '/m/s2.svg' };
  if (/\/api\/scenes\/\w+\/similar/.test(p)) return { items: Array.from({ length: 6 }, (_, i) => disc(i)) };
  if (p === '/api/scenes') return feed(12, disc);
  if (p === '/api/scenes/tags') return [];
  if (/\/api\/library\/scenes\/\d+\/recommended/.test(p)) return { items: Array.from({ length: 10 }, (_, i) => lib(i)) };
  if (p === '/api/library/scenes/103') return { ...lib(3), libraryStudioId: '3', performers: [{ id: '7', name: 'Anna Example', imageUrl: '/m/face1.svg' }], tags: [{ id: 't', name: 'Outdoor' }] };
  if (p === '/api/library/scenes') return { ...feed(9, lib), latestSyncAt: null };
  if (p === '/api/library/search') return { query: 'an', scenes: { total: 9, page: 1, perPage: 6, hasMore: true, items: Array.from({ length: 6 }, (_, i) => lib(i)) }, performers: ['Anna Example', 'Dana Other', 'Hannah Long-Name Person'].map((n, i) => ({ id: String(i), name: n, imageUrl: `/m/face${i}.svg`, sceneCount: 9 - i })), studios: [{ id: '3', name: 'Anchor Studios', imageUrl: '/m/logo1.svg', sceneCount: 5 }], tags: ['Anal', 'Candid'].map((n, i) => ({ id: 't' + i, name: n, sceneCount: 5 })) };
  if (p.startsWith('/api/groups/for-scene/')) return [{ id: '5', name: 'Weekend Getaway', sceneIndex: 1 }];
  if (p === '/api/groups') return feed(3, (i) => ({ id: String(5 + i), name: ['Weekend Getaway', 'Beach Days', 'City Lights Collection'][i], date: null, studio: studios[i], sceneCount: 3 + i, coverImageUrl: `/m/s${i}.svg` }));
  if (p === '/api/groups/5') return { id: '5', name: 'Weekend Getaway', date: null, studio: 'Anchor Studios', sceneCount: 3, coverImageUrl: '/m/s1.svg', synopsis: 'A three-part story.', viewUrl: 'http://stash/groups/5', scenes: [1, 2, 3].map((i) => ({ ...lib(i), sceneIndex: i })) };
  if (p === '/api/performers') return feed(12, (i) => ({ id: 'p' + i, name: ['Anna Example', 'Dana Other', 'Mia Third', 'Lena Long Surname'][i % 4], gender: 'FEMALE', sceneCount: 40 - i, isFavorite: i % 3 === 0, imageUrl: `/m/face${i % 3}.svg`, cardImageUrl: null }));
  if (p === '/api/performers/p1') return performer;
  if (p === '/api/performers/p1/scenes') return feed(12, disc);
  if (p === '/api/performers/p1/monitoring') return { monitored: false, monitoredSince: null };
  if (p === '/api/studios') return feed(12, (i) => ({ id: 'st' + i, name: studios[i % 4], isFavorite: i % 3 === 0, imageUrl: `/m/logo${i % 4}.svg`, parentStudio: null, childStudios: [] }));
  if (p === '/api/studios/st1') return studio;
  if (p === '/api/galleries') return feed(8, (i) => ({ id: 'g' + i, title: titles[i], description: null, coverImageUrl: `/m/s${i}.svg`, studioId: null, studio: studios[i % 4], studioImageUrl: null, performers: [{ id: 'p1', name: 'Anna Example', imageUrl: '/m/face1.svg' }], tagIds: [], tagNames: [], imageCount: 20 + i, releaseDate: '2025-01-01', viewUrl: 'x', createdAt: null, updatedAt: null }));
  if (p === '/api/acquisition/scenes') return { total: 6, page: 1, perPage: 24, hasMore: false, countsByLifecycle: { REQUESTED: 2, DOWNLOADING: 2, IMPORT_PENDING: 1, FAILED: 1 }, items: Array.from({ length: 6 }, (_, i) => ({ ...disc(i), status: { state: ['REQUESTED', 'DOWNLOADING', 'IMPORT_PENDING', 'FAILED'][i % 4] }, queueStatus: 'downloading', queueState: null, errorMessage: i % 4 === 3 ? 'Download failed' : null, whisparrViewUrl: 'http://w' })) };
  if (p === '/api/integrations') return [];
  if (p === '/api/settings/preferences') return { hideAmateurNetworkResults: true, defaultRootFolderPath: '/data/scenes', defaultQualityProfileId: 2, defaultMonitored: true, defaultSearchForMovie: true, defaultTagIds: [] };
  if (p === '/api/requests/options') return { rootFolders: [{ path: '/data/scenes', accessible: true, freeSpace: 500000000000 }], qualityProfiles: [{ id: 1, name: 'Any' }, { id: 2, name: 'HD-1080p' }], tags: [] };
  if (p.endsWith('/playback-info')) return { resumeSeconds: 0, duration: 1600 };
  return {}; };
const mime = { js: 'text/javascript', css: 'text/css', html: 'text/html', svg: 'image/svg+xml', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', json: 'application/json', ico: 'image/x-icon' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));


const clip = (id) => '/demo/v' + ((((parseInt(id, 10) || 0) - 100) % 9 + 9) % 9) + '.webm';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'] });
const DESKTOP = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

async function open(viewport, path) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.setRequestInterception(true);
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  page.on('request', (r) => { const u = new URL(r.url());
  if (u.host !== 'app.local') return r.respond({ status: 404, body: '' });
  const media = u.pathname.match(/^\/api\/media\/stash\/scenes\/(\d+)\/(preview|stream)$/);
  if (media) return r.respond({ contentType: 'video/webm', body: readFileSync(clip(media[1])) });
  const cat = u.pathname.match(/^\/api\/scenes\/c?(\d+|abc|req)\/stream$/);
  if (cat) { const n = /^\d+$/.test(cat[1]) ? 100 + parseInt(cat[1], 10) : 104; return r.respond({ contentType: 'application/json', body: JSON.stringify({ stashSceneId: String(n), streamUrl: '/api/media/stash/scenes/' + n + '/stream', duration: 1200, resumeSeconds: 0 }) }); }
  if (u.pathname.startsWith('/m/')) { const n = u.pathname.slice(3); const k = parseInt(n.replace(/\D/g, '') || '0'); if (n.startsWith('s')) return r.respond({ contentType: 'image/jpeg', body: readFileSync('/demo/sb' + (k % 9) + '.jpg') }); if (n.startsWith('logo')) return r.respond({ contentType: 'image/svg+xml', body: readFileSync('/demo/logo' + (k % 4) + '.svg') }); return r.respond({ contentType: 'image/svg+xml', body: svg(600, 900, ['#c48', '#a6a', '#c86'][k % 3]) }); }
  if (/\/(screenshot|cover|photo|logo)$/.test(u.pathname)) return r.respond({ contentType: 'image/svg+xml', body: svg(640, 360, colors[3]) });
  if (u.pathname.startsWith('/api/')) return r.respond({ contentType: 'application/json', body: JSON.stringify(api(r.url())) });
  const f = DIST + u.pathname; if (u.pathname !== '/' && existsSync(f)) return r.respond({ contentType: mime[f.split('.').pop()] ?? 'application/octet-stream', body: readFileSync(f) });
  return r.respond({ contentType: 'text/html', body: readFileSync(DIST + '/index.html') }); });
  if (!viewport.isMobile) {
  // A visible cursor (headless screenshots have none), with a ring on click.
await page.evaluateOnNewDocument(() => {
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.id = 'demo-cursor';
    c.style.cssText = 'position:fixed;z-index:99999;left:0;top:0;width:22px;height:22px;pointer-events:none;transform:translate(-3px,-2px);transition:transform 80ms';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.6-6.8L4 20z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { c.style.transform = 'translate(-3px,-2px) scale(0.8)'; }, true);
    addEventListener('mouseup', () => { c.style.transform = 'translate(-3px,-2px)'; }, true);
  });
});
  }
  await page.goto(BASE + path, { waitUntil: 'networkidle0' });
  await page.addStyleTag({ content: '.hero-ambient { opacity: 0.6 !important; }' });
  await wait(2800);
  return page;
}
async function glide(page, x, y, steps = 12) { await page.mouse.move(x, y, { steps }); }
async function clickOn(page, selector) {
  const el = await page.$(selector);
  if (!el) { console.log('MISSING', selector); return; }
  const b = await el.boundingBox();
  await glide(page, b.x + b.width / 2, b.y + b.height / 2);
  await wait(200); await page.mouse.down(); await wait(90); await page.mouse.up();
}
async function record(name, viewport, path, act) {
  const page = await open(viewport, path);
  if (!viewport.isMobile) await page.mouse.move(viewport.width * 0.7, viewport.height * 0.4);
  const rec = await page.screencast({ path: '/out/' + name + '.webm' });
  const t0 = Date.now();
  await act(page);
  await rec.stop();
  console.log('CLIP', name, ((Date.now() - t0) / 1000).toFixed(1));
  await page.close();
}
const smooth = (page, top) => page.evaluate((y) => scrollTo({ top: y, behavior: 'smooth' }), top);

const marks = {};
async function recordM(name, viewport, path, act) {
  const page = await open(viewport, path);
  if (!viewport.isMobile) await page.mouse.move(viewport.width * 0.7, viewport.height * 0.4);
  const rec = await page.screencast({ path: '/out/' + name + '.webm' });
  const t0 = Date.now();
  marks[name] = { events: [] };
  const mark = async (label, selector) => {
    let box = null;
    if (selector) {
      const el = await page.$(selector);
      const b = el && (await el.boundingBox());
      if (b) box = [b.x + b.width / 2, b.y + b.height / 2, b.width, b.height];
    }
    marks[name].events.push({ label, t: (Date.now() - t0) / 1000, box });
  };
  await act(page, mark);
  await rec.stop();
  marks[name].wall = (Date.now() - t0) / 1000;
  console.log('CLIP', name, marks[name].wall.toFixed(1));
  await page.close();
}
async function typeSlow(page, text) { for (const ch of text) { await page.keyboard.type(ch); await wait(160); } }

// Previews: hover a card, it plays.
await recordM('a2-desk-hover', DESKTOP, '/home', async (p, mark) => {
  await smooth(p, 430); await wait(900);
  const card = (await p.$$('app-scene-card'))[1];
  const b = await card.boundingBox();
  await mark('hover', null);
  marks['a2-desk-hover'].events[0].box = [b.x + b.width / 2, b.y + b.height * 0.32, b.width, b.height * 0.64];
  await glide(p, b.x + b.width / 2, b.y + b.height * 0.32, 22);
  await wait(4200);
});
// One click: request on Scenes.
await recordM('c2-desk-request', DESKTOP, '/scenes', async (p, mark) => {
  await smooth(p, 120); await wait(900);
  await mark('request', '.request-action');
  await clickOn(p, '.request-action');
  await mark('requested', '.title-action.status-action');
  await wait(3000);
});
// Search: type in the masthead search, see performers, sites, scenes.
await recordM('g-desk-search', DESKTOP, '/home', async (p, mark) => {
  await wait(600);
  await mark('search', '.masthead input[type="search"], .masthead input');
  await clickOn(p, '.masthead input[type="search"], .masthead input');
  await typeSlow(p, 'anna');
  await p.keyboard.press('Enter');
  await wait(1800);
  await smooth(p, 260); await wait(2000);
});
// Watch: Play on the banner, then leave -- the miniplayer carries on.
await recordM('e2-desk-play', DESKTOP, '/home', async (p, mark) => {
  await wait(500);
  await mark('play', '.hero-play');
  await clickOn(p, '.hero-play');
  await wait(2600);
  await mark('home', 'a.nav-item[href="/home"]');
  await clickOn(p, 'a.nav-item[href="/home"]');
  await wait(800);
  await mark('mini', '[data-testid="miniplayer"]');
  await wait(2600);
});
// Performer page: the collage, then the header docks as you scroll.
await recordM('i-desk-performer', DESKTOP, '/performer/p1', async (p, mark) => {
  await wait(1500);
  await mark('scroll', null);
  await smooth(p, 420); await wait(1600);
  await smooth(p, 760); await wait(1800);
});
// Phone: search results.
await recordM('h-phone-search', PHONE, '/search?q=anna', async (p) => { await wait(1200); await smooth(p, 380); await wait(2200); await smooth(p, 760); await wait(1800); });
// Phone: performer page.
await recordM('j-phone-performer', PHONE, '/performer/p1', async (p) => { await wait(1000); await smooth(p, 330); await wait(2000); await smooth(p, 700); await wait(1800); });

writeFileSync('/out/marks.json', JSON.stringify(marks, null, 1));
await browser.close();
