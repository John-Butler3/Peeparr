// Workflow clips for the ad: appended to clips.mjs's setup (everything before its first recording). The Acquisition mock there drops FAILED for these.
// Download: the Acquisition page, each request on its way in.
await recordM('k-desk-download', DESKTOP, '/acquisition', async (p, mark) => {
  await wait(900);
  await glide(p, 760, 300, 20); await wait(700);
  await smooth(p, 520); await wait(1700);
  await mark('card', null);
  await smooth(p, 1000); await wait(1800);
  await smooth(p, 1500); await wait(1600);
});
// Phone: tap Request on a scene in the catalog.
await recordM('l-phone-request', PHONE, '/scenes', async (p, mark) => {
  const first = await p.$('.request-action'); const fb = first && (await first.boundingBox()); await p.evaluate((y) => scrollTo({ top: y }), 0); await wait(300);
  if (fb) { await smooth(p, Math.max(0, fb.y - 330)); } await wait(1400);
  const btns = await p.$$('.request-action');
  let b = null;
  for (const el of btns) { const bb = await el.boundingBox(); if (bb && bb.y > 120 && bb.y < 700) { b = bb; break; } }
  if (!b) { console.log('MISSING phone request'); return; }
  await mark('tap', null);
  marks['l-phone-request'].events[0].box = [b.x + b.width / 2, b.y + b.height / 2, b.width, b.height];
  await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await mark('tapped', null);
  await wait(3200);
});
writeFileSync('/out/marks.json', JSON.stringify(marks, null, 1));
await browser.close();
