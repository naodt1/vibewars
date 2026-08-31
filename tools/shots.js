/* Screenshots for the "How to play" guide.
 *
 * These are real captures of the real game, not mockups: the script boots a
 * server on its own port, drives a full battle through the actual UI in
 * headless Chrome, and clips a named element out of each phase. Regenerating
 * them after a design change is one command, which is the whole point - a
 * hand-cropped screenshot rots the moment a colour token moves.
 *
 *   node tools/shots.js
 *
 * Chrome is driven over CDP through the `ws` dependency the server already
 * has, so nothing new is installed. Captures are taken at deviceScaleFactor 2
 * so they stay sharp on a retina display, then written to public/how/.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = 4599;
const CDP_PORT = 9333;
const OUT = path.join(__dirname, '..', 'public', 'how');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE = path.join(require('os').tmpdir(), 'vibewars-shots-profile');

const VIEW = { width: 1440, height: 900, scale: 2 };

/* Which file each shot ended up in. The format is chosen per image by whichever
 * encoder wins, so the extension is not knowable ahead of time - and a guide
 * with a hardcoded `.png` in it would silently lose its images the first time
 * a redesign made one of them compress better as a JPEG. The page reads this
 * manifest instead. */
const manifest = [];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* --------------------------------------------------------------- CDP ----- */

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }

  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    const cdp = new Cdp(ws);
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
      const p = cdp.pending.get(msg.id);
      if (!p) return;
      cdp.pending.delete(msg.id);
      msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
    });
    return cdp;
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) rej(new Error(method + ' timed out'));
      }, 30000);
    });
  }

  /** Run an expression in the page and return its value. Throws on page errors. */
  async eval(expression) {
    const out = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (out.exceptionDetails) {
      throw new Error('page error: ' + (out.exceptionDetails.exception?.description ||
        out.exceptionDetails.text));
    }
    return out.result.value;
  }

  close() { try { this.ws.close(); } catch (_) {} }
}

/** Poll an expression in the page until it is true. */
async function until(cdp, expression, label, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cdp.eval(`return !!(${expression});`)) return;
    await wait(120);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/* ------------------------------------------------------------ capture ---- */

/** Clip one element (plus padding) out of the page and write it to disk. */
async function shoot(cdp, name, selector, { pad = 0, maxHeight = 0, maxPx = 2000 } = {}) {
  /* A second player's page steals the foreground, and a backgrounded tab stops
   * firing requestAnimationFrame - which used to hang the capture forever.
   * Front the tab being shot, and settle with a timer rather than a frame. */
  await cdp.send('Page.bringToFront');
  /* A selector may be a list, in which case the clip is the box that contains
   * all of them - an open dropdown is positioned outside its own card, and
   * cropping to the card alone would cut the list off. */
  const selectors = Array.isArray(selector) ? selector : [selector];
  const box = await cdp.eval(`
    const sels = ${JSON.stringify(selectors)};
    const els = sels.map(s => document.querySelector(s)).filter(Boolean);
    if (!els.length) return null;
    els[0].scrollIntoView({ block: 'center' });
    await new Promise(r => setTimeout(r, 250));
    const rects = els.map(e => e.getBoundingClientRect());
    const left = Math.min(...rects.map(r => r.left));
    const top = Math.min(...rects.map(r => r.top));
    const right = Math.max(...rects.map(r => r.right));
    const bottom = Math.max(...rects.map(r => r.bottom));
    return { x: left + scrollX, y: top + scrollY, w: right - left, h: bottom - top };
  `);
  if (!box) throw new Error(`no element for ${name}: ${selector}`);

  const width = box.w + pad * 2;

  /* Two multipliers apply here, and only one of them is obvious. The viewport
   * is already emulated at deviceScaleFactor VIEW.scale, and clip.scale is
   * applied *on top of* it - so a clip scale of 2 on a 2x viewport produced 4x
   * images, and every screenshot was four times the weight it needed to be.
   * Work out the output multiplier we actually want, then divide out what the
   * device is already contributing. */
  const outputScale = Math.min(VIEW.scale, maxPx / width);

  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width,
    height: maxHeight ? Math.min(box.h + pad * 2, maxHeight) : box.h + pad * 2,
    scale: outputScale / VIEW.scale,
  };

  /* Neither format wins outright. Flat UI panels are mostly runs of one
   * colour, which PNG encodes to almost nothing and JPEG wastes bits on; the
   * build screen is full of gradients from the live preview, where the
   * opposite is true - it is a 2MB PNG and a 750KB JPEG. So encode both and
   * keep the smaller file. It costs one extra capture and takes the guide
   * from 3MB of images to well under one. */
  const grab = (opts) => cdp.send('Page.captureScreenshot', {
    clip, captureBeyondViewport: true, fromSurface: true, ...opts,
  }).then((r) => Buffer.from(r.data, 'base64'));

  const [png, jpg] = await Promise.all([
    grab({ format: 'png' }),
    grab({ format: 'jpeg', quality: 86 }),
  ]);
  const useJpg = jpg.length < png.length;
  const ext = useJpg ? 'jpg' : 'png';
  const buf = useJpg ? jpg : png;

  // Anything left over from a previous run in the other format would be dead
  // weight in the repo and, worse, silently served if a path went stale.
  for (const other of ['png', 'jpg']) {
    if (other !== ext) fs.rmSync(path.join(OUT, name + '.' + other), { force: true });
  }
  const file = path.join(OUT, name + '.' + ext);
  fs.writeFileSync(file, buf);
  const kb = Math.round(buf.length / 1024);
  manifest.push({
    key: name,
    file: name + '.' + ext,
    w: Math.round(clip.width * outputScale),
    h: Math.round(clip.height * outputScale),
  });
  console.log(`  ${name}.${ext}  ${Math.round(width * outputScale)}px wide  ${kb}KB` +
              `  (png ${Math.round(png.length / 1024)}KB / jpg ${Math.round(jpg.length / 1024)}KB)`)
}

/* --------------------------------------------------------------- run ----- */

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });

  console.log('booting server...');
  const srv = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    // No database: these are illustrations, they must not write to the archive.
    env: { ...process.env, PORT: String(PORT), SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await wait(1200);

  console.log('launching chrome...');
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + PROFILE,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    /* Two players means one of the two tabs is always in the background, and a
     * backgrounded tab has its timers throttled to about once a second - which
     * silently turned a 20 second scripted round into a 20 minute one. */
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--force-color-profile=srgb', '--disable-lcd-text',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  let cdp;
  try {
    // Wait for the debugger to come up, then open a page target.
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      await wait(250);
      try {
        const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
        target = list.find((t) => t.type === 'page');
      } catch (_) { /* not up yet */ }
    }
    if (!target) throw new Error('chrome devtools never answered');

    cdp = await Cdp.attach(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEW.width, height: VIEW.height,
      deviceScaleFactor: VIEW.scale, mobile: false,
    });
    // Animations would otherwise be caught mid-flight and land in the crop.
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });

    /* Opening a second page lets a real second player join the lobby. The
     * stand-in players ship a fixed example submission, which is fine in a
     * real game but would put a bill splitter under a houseplant brief in the
     * guide - so the entry being judged belongs to an actual second browser
     * playing the same round. */
    const extras = [];
    const openPlayer = async () => {
      const t = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })
        .then((r) => r.json());
      const c = await Cdp.attach(t.webSocketDebuggerUrl);
      await c.send('Page.enable');
      await c.send('Runtime.enable');
      await c.send('Emulation.setDeviceMetricsOverride', {
        width: VIEW.width, height: VIEW.height, deviceScaleFactor: 1, mobile: false,
      });
      extras.push({ cdp: c, id: t.id });
      return c;
    };

    try {
      await require('./scenes')({ cdp, shoot, until, wait, PORT, openPlayer });
    } finally {
      for (const e of extras) {
        e.cdp.close();
        await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${e.id}`).catch(() => {});
      }
    }
    fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify(manifest, null, 2) + '\n');
    const total = manifest.reduce((n, m) => n + fs.statSync(path.join(OUT, m.file)).size, 0);
    console.log(`\ndone -> public/how/  (${manifest.length} shots, ${Math.round(total / 1024)}KB total)`);
  } finally {
    if (cdp) cdp.close();
    chrome.kill();
    srv.kill();
    await wait(400);
    // Best effort: Chrome may still be flushing the profile, and a cleanup
    // failure here would otherwise mask whatever actually went wrong above.
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch (_) { /* a temp profile left behind is not worth failing over */ }
  }
})().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
