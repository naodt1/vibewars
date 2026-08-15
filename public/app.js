/* vibewars client. Vanilla JS, no build step. */

const $ = (id) => document.getElementById(id);

/* -------------------------------------------------------------- confetti -- *
 * Canvas particle burst for the winner. Vanilla, no library, palette-matched,
 * and it bows out entirely when the viewer prefers reduced motion. */

// Warm family around the accent, mid-bright so it reads on either background.
// The foreground token is mixed in so there is always something contrasting.
const CONFETTI_COLORS = ['#FF7A2F', '#FFB56B', '#FFD9A0', '#E85D2A', '#FF9A55'];

function confettiPalette() {
  const fg = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim();
  return fg ? [...CONFETTI_COLORS, fg] : CONFETTI_COLORS;
}

/** The four-point sparkle from the rest of the UI, drawn as a path. */
function drawSparkle(ctx, r) {
  const k = r * 0.14;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(k, -k, r, 0);
  ctx.quadraticCurveTo(k, k, 0, r);
  ctx.quadraticCurveTo(-k, k, -r, 0);
  ctx.quadraticCurveTo(-k, -k, 0, -r);
  ctx.closePath();
  ctx.fill();
}

function makeConfetti(w, h, count = 170) {
  const pieces = [];
  const palette = confettiPalette();
  for (let i = 0; i < count; i++) {
    pieces.push({
      x: w * (0.1 + 0.8 * Math.random()),
      y: -30 - Math.random() * h * 0.6,
      w: 6 + Math.random() * 8,
      h: 8 + Math.random() * 12,
      vx: (Math.random() - 0.5) * 2.6,
      vy: 2 + Math.random() * 3.4,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.26,
      color: palette[i % palette.length],
      sparkle: Math.random() < 0.28,
    });
  }
  return pieces;
}

/** Advance one frame. Returns true while anything is still above the bottom. */
function stepConfetti(pieces, h) {
  let onScreen = false;
  for (const p of pieces) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.05;
    p.vx *= 0.995;
    p.rot += p.vr;
    if (p.y < h + 60) onScreen = true;
  }
  return onScreen;
}

function drawConfetti(ctx, pieces, w, h, fade) {
  ctx.clearRect(0, 0, w, h);
  for (const p of pieces) {
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.sparkle) drawSparkle(ctx, p.w * 0.9);
    else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
}

function fireConfetti(durationMs = 4200) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // requestAnimationFrame is suspended in a hidden tab, so a burst fired while
  // someone is off reading their LLM would be swallowed. Hold it until they look.
  if (document.hidden) {
    const onVisible = () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', onVisible);
      fireConfetti(durationMs);
    };
    document.addEventListener('visibilitychange', onVisible);
    return;
  }

  const canvas = $('confetti');
  const ctx = canvas.getContext('2d');
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvas.style.display = 'block';

  const pieces = makeConfetti(w, h);
  const start = performance.now();
  const frame = (now) => {
    const t = now - start;
    const onScreen = stepConfetti(pieces, h);
    // Fade the whole burst out over the last second instead of cutting it.
    const fade = Math.max(0, 1 - Math.max(0, t - (durationMs - 1000)) / 1000);
    drawConfetti(ctx, pieces, w, h, fade);
    if (t < durationMs && onScreen) {
      requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, w, h);
      canvas.style.display = 'none';
    }
  };
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------ syntax highlight -- *
 * Hand-rolled because the app has no build step and pulls in no libraries.
 * Everything is escaped on the way out, so a submission can never inject markup
 * into the editor chrome. */

const JS_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'break',
  'continue', 'new', 'class', 'extends', 'this', 'typeof', 'instanceof', 'null', 'undefined',
  'true', 'false', 'try', 'catch', 'finally', 'throw', 'switch', 'case', 'default', 'await',
  'async', 'of', 'in', 'delete', 'void', 'yield', 'static', 'get', 'set', 'import', 'export',
]);

function escHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function tok(cls, text) {
  return `<span class="t-${cls}">${escHtml(text)}</span>`;
}

function highlightJs(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      const stop = nl === -1 ? n : nl;
      out += tok('com', src.slice(i, stop));
      i = stop;
    } else if (c === '/' && src[i + 1] === '*') {
      let e = src.indexOf('*/', i + 2);
      e = e === -1 ? n : e + 2;
      out += tok('com', src.slice(i, e));
      i = e;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++;
        j++;
      }
      const end = Math.min(j + 1, n);
      out += tok('str', src.slice(i, end));
      i = end;
    } else {
      const word = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
      if (word) {
        out += JS_KEYWORDS.has(word[0]) ? tok('kw', word[0]) : escHtml(word[0]);
        i += word[0].length;
        continue;
      }
      const num = /^\d[\d.]*/.exec(src.slice(i));
      if (num) {
        out += tok('num', num[0]);
        i += num[0].length;
        continue;
      }
      out += escHtml(c);
      i++;
    }
  }
  return out;
}

function highlightCss(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {
      let e = src.indexOf('*/', i + 2);
      e = e === -1 ? n : e + 2;
      out += tok('com', src.slice(i, e));
      i = e;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++;
        j++;
      }
      const end = Math.min(j + 1, n);
      out += tok('str', src.slice(i, end));
      i = end;
    } else {
      const prop = /^([-A-Za-z]+)(\s*:)/.exec(src.slice(i));
      if (prop) {
        out += tok('attr', prop[1]) + tok('p', prop[2]);
        i += prop[0].length;
        continue;
      }
      out += escHtml(c);
      i++;
    }
  }
  return out;
}

function highlightHtml(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      out += escHtml(src.slice(i));
      break;
    }
    if (lt > i) out += escHtml(src.slice(i, lt));
    i = lt;

    if (src.startsWith('<!--', i)) {
      let e = src.indexOf('-->', i + 4);
      e = e === -1 ? n : e + 3;
      out += tok('com', src.slice(i, e));
      i = e;
      continue;
    }
    if (src.startsWith('<!', i)) {
      let e = src.indexOf('>', i);
      e = e === -1 ? n : e + 1;
      out += tok('dt', src.slice(i, e));
      i = e;
      continue;
    }

    const open = /^<\/?([A-Za-z][\w:-]*)/.exec(src.slice(i));
    if (!open) {
      out += escHtml('<');
      i++;
      continue;
    }
    const isClose = src[i + 1] === '/';
    const tagName = open[1];
    out += tok('p', isClose ? '</' : '<') + tok('tag', tagName);
    i += open[0].length;

    while (i < n && src[i] !== '>') {
      const ws = /^\s+/.exec(src.slice(i));
      if (ws) {
        out += escHtml(ws[0]);
        i += ws[0].length;
        continue;
      }
      if (src[i] === '/') {
        out += tok('p', '/');
        i++;
        continue;
      }
      const attr = /^[^\s=/>]+/.exec(src.slice(i));
      if (!attr) {
        out += escHtml(src[i]);
        i++;
        continue;
      }
      out += tok('attr', attr[0]);
      i += attr[0].length;
      if (src[i] === '=') {
        out += tok('p', '=');
        i++;
        const q = src[i];
        if (q === '"' || q === "'") {
          let e = src.indexOf(q, i + 1);
          e = e === -1 ? n : e + 1;
          out += tok('str', src.slice(i, e));
          i = e;
        } else {
          const val = /^[^\s>]+/.exec(src.slice(i));
          if (val) {
            out += tok('str', val[0]);
            i += val[0].length;
          }
        }
      }
    }
    if (i < n && src[i] === '>') {
      out += tok('p', '>');
      i++;
    }

    // <script> and <style> hold raw text, not markup.
    const lower = tagName.toLowerCase();
    if (!isClose && (lower === 'script' || lower === 'style')) {
      const close = src.toLowerCase().indexOf('</' + lower, i);
      const end = close === -1 ? n : close;
      const body = src.slice(i, end);
      out += lower === 'script' ? highlightJs(body) : highlightCss(body);
      i = end;
    }
  }
  return out;
}

// Past this the per-token slicing starts to cost more than the colour is worth,
// so very large pastes fall back to plain (still escaped) text.
const HIGHLIGHT_LIMIT = 60000;

function syncHighlight() {
  const ta = $('codeInput');
  const src = ta.value;
  // The trailing newline keeps the painted layer as tall as the caret can go.
  $('codeHighlight').innerHTML =
    (src.length > HIGHLIGHT_LIMIT ? escHtml(src) : highlightHtml(src)) + '\n';
  const layer = document.querySelector('.editor-highlight');
  layer.scrollTop = ta.scrollTop;
  layer.scrollLeft = ta.scrollLeft;
}

/* ------------------------------------------------------------- sandbox -- *
 * Prompt your own model from inside the round. The call goes browser ->
 * provider with your own key, exactly like the model-list check: nothing passes
 * through the vibewars server, so the host never sees a key or a prompt.
 *
 * Token counts come back from the provider and are summed for the round. They
 * are counts, not money: pricing changes, and guessing at it would be worse
 * than saying nothing. */

const CHAT = {
  openai: {
    url: () => 'https://api.openai.com/v1/chat/completions',
    headers: (key) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }),
    body: (model, messages) => ({ model, messages, max_tokens: 4096 }),
    text: (j) => j.choices?.[0]?.message?.content || '',
    usage: (j) => ({ in: j.usage?.prompt_tokens || 0, out: j.usage?.completion_tokens || 0 }),
  },
  xai: {
    url: () => 'https://api.x.ai/v1/chat/completions',
    headers: (key) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }),
    body: (model, messages) => ({ model, messages, max_tokens: 4096 }),
    text: (j) => j.choices?.[0]?.message?.content || '',
    usage: (j) => ({ in: j.usage?.prompt_tokens || 0, out: j.usage?.completion_tokens || 0 }),
  },
  anthropic: {
    url: () => 'https://api.anthropic.com/v1/messages',
    headers: (key) => ({
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    }),
    // Anthropic takes the system prompt as its own field, not as a message.
    body: (model, messages) => ({
      model,
      max_tokens: 4096,
      system: messages.find((m) => m.role === 'system')?.content,
      messages: messages.filter((m) => m.role !== 'system'),
    }),
    text: (j) => (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''),
    usage: (j) => ({ in: j.usage?.input_tokens || 0, out: j.usage?.output_tokens || 0 }),
  },
  google: {
    url: (key, model) =>
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      model + ':generateContent?key=' + encodeURIComponent(key),
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (model, messages) => {
      const sys = messages.find((m) => m.role === 'system');
      return {
        systemInstruction: sys ? { parts: [{ text: sys.content }] } : undefined,
        contents: messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
      };
    },
    text: (j) => (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join(''),
    usage: (j) => ({
      in: j.usageMetadata?.promptTokenCount || 0,
      out: j.usageMetadata?.candidatesTokenCount || 0,
    }),
  },
};

/* Which providers this instance funds with its own key, so the sandbox works
 * for players who never connect one. Loaded once at boot; defaults to "none"
 * until it resolves, which just means the sandbox looks key-less for the
 * first instant rather than erroring. */
let houseConfig = { house: {}, houseCallsPerRound: 6 };
fetch('/api/config')
  .then((r) => r.json())
  .then((cfg) => {
    houseConfig = cfg;
    // The fetch can land after the player is already looking at the key step
    // or the sandbox, so repaint whichever of those is on screen.
    if (wizFlow) renderWizard();
    if (state && !state.spectating) renderSandboxControls();
  })
  .catch(() => {}); // no house key info: everyone just needs their own key, as before

const sandbox = {
  messages: [], // the running conversation, system prompt included
  tokensIn: 0,
  tokensOut: 0,
  requests: 0,
  houseUsed: 0, // house-key calls spent this round, for the remaining-count display
  busy: false,
  locked: false,
  controller: null,
};

/** Build the system prompt from the brief so the model knows the real task. */
function sandboxSystemPrompt(lobby) {
  const p = lobby.prompt || {};
  const lines = [
    'You are competing in a timed vibe coding battle.',
    'Return ONE self-contained HTML file and nothing else: no explanation, no commentary.',
    'Inline all CSS and JavaScript. No frameworks, no build step, no external requests.',
    '',
    'PRODUCT: ' + (p.productName || ''),
    'TASK: ' + (p.task || ''),
  ];
  if ((p.constraints || []).length) {
    lines.push('CONSTRAINTS:\n- ' + p.constraints.join('\n- '));
  }
  return lines.join('\n');
}

// A fenced ```html block if there is one, otherwise the whole reply when it
// already looks like markup.
const FENCE = new RegExp('```(?:html)?\\s*\\n([\\s\\S]*?)```', 'i');
const LOOKS_LIKE_HTML = /<(!doctype|html|body|div|h1|section|main|style)\b/i;

function extractHtml(text) {
  const fenced = text.match(FENCE);
  if (fenced) return fenced[1].trim();
  if (LOOKS_LIKE_HTML.test(text)) return text.trim();
  return null;
}

/** One completion call. Readable errors, and abortable by the buzzer. */
async function callModel(providerId, modelId, messages, signal) {
  const spec = CHAT[providerId];
  const key = storedKeys()[providerId];
  if (!spec || !key) throw new Error('No key connected for that provider.');

  const res = await fetch(spec.url(key, modelId), {
    method: 'POST',
    headers: spec.headers(key),
    body: JSON.stringify(spec.body(modelId, messages)),
    signal,
  });

  if (!res.ok) {
    let detail = '';
    try {
      const err = await res.json();
      detail = err.error?.message || err.message || '';
    } catch (e) {
      /* error body was not JSON */
    }
    if (res.status === 429) throw new Error('Rate limited by the provider. Give it a second.');
    if ([400, 401, 403].includes(res.status)) {
      throw new Error(detail || 'The provider rejected that request.');
    }
    throw new Error(detail || 'Provider returned ' + res.status + '.');
  }

  const json = await res.json();
  return { text: spec.text(json), usage: spec.usage(json) };
}

/** The house-key path: server holds the key, we only send the conversation
 *  and prove who we are with the same resume token 'resume' trusts. No key
 *  is ever in this request, because we never had one to begin with. Reads
 *  the token from the in-memory `myToken` (set on 'joined') rather than
 *  sessionStorage, so an in-flight round keeps working off the identity the
 *  rest of the app is already trusting, even if storage were ever cleared
 *  or inaccessible for reasons unrelated to this session. */
async function callModelViaHouse(providerId, messages, signal) {
  const res = await fetch('/api/sandbox/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lobbyId: state.lobby.id,
      participantId: me,
      token: myToken,
      provider: providerId,
      messages,
    }),
    signal,
  });
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    /* error body was not JSON */
  }
  if (!res.ok) throw new Error((json && json.message) || 'House key request failed.');
  return json;
}

function renderUsage() {
  const el = $('usageMeter');
  if (!el) return;
  const total = sandbox.tokensIn + sandbox.tokensOut;
  el.innerHTML = total
    ? '<span class="usage-num">' + total.toLocaleString() + '</span> tokens' +
      '<span class="meta-sep">/</span>' + sandbox.tokensIn.toLocaleString() + ' in' +
      '<span class="meta-sep">/</span>' + sandbox.tokensOut.toLocaleString() + ' out' +
      '<span class="meta-sep">/</span>' + sandbox.requests +
      (sandbox.requests === 1 ? ' call' : ' calls')
    : 'No calls yet';
}

function renderChat() {
  const log = $('chatLog');
  if (!log) return;
  const turns = sandbox.messages.filter((m) => m.role !== 'system');
  if (!turns.length && !sandbox.busy) {
    log.innerHTML =
      '<p class="chat-empty">Ask for what you want built. The brief is already in front of the ' +
      'model, so go straight to the interesting part.</p>';
    return;
  }
  log.innerHTML =
    turns
      .map(
        (m) =>
          '<div class="turn turn-' + m.role + '">' +
          '<span class="turn-who">' + (m.role === 'user' ? 'You' : 'Model') + '</span>' +
          '<div class="turn-body">' + esc((m.display || m.content).slice(0, 4000)) + '</div></div>'
      )
      .join('') +
    (sandbox.busy
      ? '<div class="turn turn-assistant"><span class="turn-who">Model</span>' +
        '<div class="turn-body thinking">Thinking<span class="tagline-dots">' +
        '<i>.</i><i>.</i><i>.</i></span></div></div>'
      : '');
  log.scrollTop = log.scrollHeight;
}

/** Generated HTML lands in the editor, which stays the source of truth. */
function applyGeneratedHtml(html) {
  $('codeInput').value = html;
  syncHighlight();
  flushDraft();
  refreshSandboxPreview();
}

function refreshSandboxPreview() {
  const frame = $('sandboxFrame');
  if (frame) frame.srcdoc = $('codeInput').value || '<!-- nothing yet -->';
}

async function sendPrompt() {
  if (sandbox.busy || sandbox.locked || !state) return;
  const input = $('promptInput');
  const text = input.value.trim();
  if (!text) return;

  const mine = myParticipant();
  const tool = mine && mine.tool;
  // Your own key first if it is verified for this exact pick; otherwise fall
  // back to the house key for whichever provider the pick actually belongs
  // to, verified or not - the house key doesn't need a real model id, since
  // the server supplies its own configured model.
  const byokProvider = providerOfModel(tool);
  const modelId = byokProvider ? modelIdFor(tool) : null;
  const byokReady = !!byokProvider && !!modelId;
  const anyProvider = providerForTool(tool);
  const houseProvider = !byokReady && anyProvider && houseConfig.house[anyProvider] ? anyProvider : null;
  if (!byokReady && !houseProvider) {
    showError('Connect a key for this model on the API keys page to use the sandbox.');
    return;
  }

  if (!sandbox.messages.length) {
    sandbox.messages.push({ role: 'system', content: sandboxSystemPrompt(state.lobby) });
  }
  sandbox.messages.push({ role: 'user', content: text });
  input.value = '';
  sandbox.busy = true;
  showError('');
  renderChat();
  renderSandboxControls();

  sandbox.controller = new AbortController();
  // The server spends one of the round's house calls the moment it attempts
  // the upstream request, regardless of whether that request succeeds - a
  // rejected or timed-out call still cost it the attempt. Counting here,
  // before the await, keeps the displayed remaining count truthful instead
  // of only ever counting the happy path.
  if (houseProvider) sandbox.houseUsed += 1;
  try {
    const out = byokReady
      ? await callModel(byokProvider, modelId, sandbox.messages, sandbox.controller.signal)
      : await callModelViaHouse(houseProvider, sandbox.messages, sandbox.controller.signal);
    sandbox.tokensIn += out.usage.in;
    sandbox.tokensOut += out.usage.out;
    sandbox.requests += 1;

    const html = extractHtml(out.text);
    sandbox.messages.push({
      role: 'assistant',
      content: out.text,
      display: html
        ? 'Returned ' + html.length.toLocaleString() + ' characters of HTML.'
        : out.text,
    });
    if (html) applyGeneratedHtml(html);
  } catch (err) {
    if (err.name === 'AbortError') {
      sandbox.messages.push({ role: 'assistant', content: '', display: 'Cut off by the buzzer.' });
    } else {
      sandbox.messages.pop(); // drop the user turn that never landed
      showError(err.message);
    }
  } finally {
    sandbox.busy = false;
    sandbox.controller = null;
    renderChat();
    renderUsage();
    renderSandboxControls();
  }
}

/** Time is up, or you submitted: the sandbox goes quiet. */
function lockSandbox() {
  if (sandbox.locked) return;
  sandbox.locked = true;
  if (sandbox.controller) sandbox.controller.abort();
  renderSandboxControls();
}

function resetSandbox() {
  if (sandbox.controller) sandbox.controller.abort();
  sandbox.messages = [];
  sandbox.tokensIn = 0;
  sandbox.tokensOut = 0;
  sandbox.requests = 0;
  sandbox.houseUsed = 0; // the server's own cap resets per round too - see resetLobby
  sandbox.busy = false;
  sandbox.locked = false;
  sandbox.controller = null;
  renderChat();
  renderUsage();
}

function renderSandboxControls() {
  const mine = myParticipant();
  const done = sandbox.locked || !!(mine && mine.submitted);
  const tool = mine && mine.tool;
  const byokProvider = providerOfModel(tool);
  const byokReady = !!byokProvider && !!modelIdFor(tool);
  const anyProvider = providerForTool(tool);
  const houseProvider = !byokReady && anyProvider && houseConfig.house[anyProvider] ? anyProvider : null;
  const ready = byokReady || !!houseProvider;

  $('promptInput').disabled = done || !ready;
  $('sendPrompt').disabled = done || sandbox.busy || !ready;
  $('sendPrompt').textContent = sandbox.busy ? 'Working' : 'Send';

  const note = $('sandboxNote');
  if (done) {
    note.textContent = 'Locked. Nothing more goes out.';
  } else if (byokReady) {
    note.textContent = 'Your key, your call. Prompts go straight to the provider.';
  } else if (houseProvider) {
    const left = Math.max(0, houseConfig.houseCallsPerRound - sandbox.houseUsed);
    note.innerHTML =
      'Using the house key for <strong>' + esc(PROVIDERS[houseProvider].label) + '</strong>. ' +
      left + ' of ' + houseConfig.houseCallsPerRound + ' prompts left this round. ' +
      '<button type="button" class="link-btn" data-open-keys>Bring your own key</button> for more.';
    const link = note.querySelector('[data-open-keys]');
    if (link) link.onclick = () => openPage('keys');
  } else {
    note.innerHTML =
      'No key connected for <strong>' +
      esc(tool || 'your model') +
      '</strong>. Paste HTML into the editor instead, or <button type="button" class="link-btn" ' +
      'data-open-keys>connect a key</button>.';
    const link = note.querySelector('[data-open-keys]');
    if (link) link.onclick = () => openPage('keys');
  }
}

/* --------------------------------------------------------------- BYOK -- *
 * Bring your own key. A key is used for exactly one thing: asking its provider
 * which models the holder can actually use, so the picker offers real options
 * instead of a hardcoded list that goes stale.
 *
 * Where keys go: localStorage, and from there straight to the provider that
 * issued them. They are never sent to the vibewars server, never written to the
 * database, and never leave the browser to any other host. That is deliberate -
 * anyone can host this, and players should not have to trust the host with a
 * credential. Submissions run in sandboxed iframes with an opaque origin, so a
 * rival's code cannot read them either.
 *
 * Each entry declares how to ask its provider for a model list. Adding a
 * provider is one object. */

const PROVIDERS = {
  openai: {
    label: 'ChatGPT / OpenAI',
    hint: 'Starts with sk-. platform.openai.com → API keys',
    url: 'https://api.openai.com/v1/models',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    parse: (json) => (json.data || []).map((m) => ({ id: m.id, label: m.id })),
    keep: (m) => /^(gpt|o\d|chatgpt)/i.test(m.id),
  },
  anthropic: {
    label: 'Claude / Anthropic',
    hint: 'Starts with sk-ant-. console.anthropic.com → API keys',
    url: 'https://api.anthropic.com/v1/models',
    headers: (key) => ({
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      // Anthropic requires this to be explicit about a browser-side call.
      'anthropic-dangerous-direct-browser-access': 'true',
    }),
    parse: (json) => (json.data || []).map((m) => ({ id: m.id, label: m.display_name || m.id })),
    keep: () => true,
  },
  google: {
    label: 'Gemini / Google',
    hint: 'aistudio.google.com → Get API key',
    url: (key) => `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    headers: () => ({}),
    parse: (json) =>
      (json.models || []).map((m) => ({
        id: String(m.name || '').replace('models/', ''),
        label: m.displayName || String(m.name || '').replace('models/', ''),
      })),
    keep: (m) => /gemini/i.test(m.id),
  },
  xai: {
    label: 'Grok / xAI',
    hint: 'console.x.ai → API keys',
    url: 'https://api.x.ai/v1/models',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    parse: (json) => (json.data || []).map((m) => ({ id: m.id, label: m.id })),
    keep: () => true,
  },
};

const KEYS_STORE = 'vibewars_keys';   // { provider: key } - never leaves the browser
const MODELS_STORE = 'vibewars_models'; // { provider: [model, ...] } - safe to keep

function readStore(name) {
  try {
    return JSON.parse(localStorage.getItem(name) || '{}') || {};
  } catch (e) {
    return {};
  }
}
function writeStore(name, value) {
  try {
    localStorage.setItem(name, JSON.stringify(value));
  } catch (e) {
    /* private browsing: keys simply do not persist */
  }
}

const storedKeys = () => readStore(KEYS_STORE);
function verifiedModels() {
  const raw = readStore(MODELS_STORE);
  const out = {};
  for (const [provider, list] of Object.entries(raw)) {
    out[provider] = (list || []).map((m) => (typeof m === 'string' ? { id: m, label: m } : m));
  }
  return out;
}

/** Ask a provider which models this key can reach. Returns models or throws. */
async function fetchModels(providerId, key) {
  const p = PROVIDERS[providerId];
  const url = typeof p.url === 'function' ? p.url(key) : p.url;
  let res;
  try {
    res = await fetch(url, { headers: p.headers(key) });
  } catch (e) {
    // Almost always the browser refusing the cross-origin call.
    throw new Error(
      'Could not reach the provider from the browser. This is usually a CORS ' +
        'restriction rather than a bad key.'
    );
  }
  // Google and xAI answer a bad key with 400 rather than 401, so treat the whole
  // client-error range as a rejection instead of leaking a bare status code.
  if ([400, 401, 403].includes(res.status)) throw new Error('That key was rejected.');
  if (!res.ok) throw new Error(`Provider returned ${res.status}.`);
  const json = await res.json();
  const models = p.parse(json)
    .filter((m) => m && m.id && p.keep(m))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (!models.length) throw new Error('The key worked but returned no usable models.');
  return models;
}

async function addKey(providerId, key) {
  const models = await fetchModels(providerId, key.trim());
  writeStore(KEYS_STORE, { ...storedKeys(), [providerId]: key.trim() });
  writeStore(MODELS_STORE, { ...verifiedModels(), [providerId]: models });
  return models;
}

function removeKey(providerId) {
  const keys = storedKeys();
  const models = verifiedModels();
  delete keys[providerId];
  delete models[providerId];
  writeStore(KEYS_STORE, keys);
  writeStore(MODELS_STORE, models);
}

/** True once at least one key has been verified. */
const hasVerifiedKeys = () => Object.keys(verifiedModels()).length > 0;

/** Which providers a model name belongs to, for the verified badge. */
function providerOfModel(label) {
  for (const [provider, list] of Object.entries(verifiedModels())) {
    if (list.some((m) => m.label === label)) return provider;
  }
  return null;
}

/** The id a provider's API expects, for a label shown in the picker. */
function modelIdFor(label) {
  for (const list of Object.values(verifiedModels())) {
    const hit = list.find((m) => m.label === label);
    if (hit) return hit.id;
  }
  return null;
}

/* Fallback catalogue, used for providers with no key attached. Edit freely -
   these are declared, not verified, and are only labels on a tile.
   Deliberately limited to the four providers this app can actually call
   (see PROVIDERS above): every group here has a real completions API behind
   it, so connecting a key always turns a declared pick into a working one.
   Coding agents/IDEs and open-weight/local models were dropped - nothing in
   the sandbox could ever call them, so listing them just set up a dead end
   where "no key needed" became the only option. Anyone actually using one of
   those can still type it into "Something else" and paste HTML by hand. */
const TOOL_GROUPS = [
  {
    name: 'ChatGPT / OpenAI',
    models: ['GPT-5.6 Sol', 'GPT-5.6 Terra', 'GPT-5.6 Luna', 'GPT-5.5', 'GPT-5.1'],
  },
  {
    name: 'Claude / Anthropic',
    models: ['Claude Fable 5', 'Claude Opus 5', 'Claude Sonnet 5', 'Claude Haiku 4.5', 'Claude Opus 4.8'],
  },
  {
    name: 'Gemini / Google',
    models: ['Gemini 3.6 Flash', 'Gemini 3.5 Pro', 'Gemini 3.5 Flash', 'Gemini 3 Pro'],
  },
  {
    name: 'Grok / xAI',
    models: ['Grok 4.5', 'Grok 4', 'Grok 4 Fast'],
  },
];

/**
 * Expandable dropdown: providers collapse/expand to reveal their models, and the
 * chosen label is written into a hidden input so the rest of the app is unchanged.
 */
/**
 * Verified providers first (real models, straight from the API), then the
 * declared fallback for anything without a key attached.
 */
function pickerGroups() {
  const models = verifiedModels();
  const verified = Object.entries(models).map(([id, list]) => ({
    name: PROVIDERS[id] ? PROVIDERS[id].label : id,
    models: list.map((m) => m.label),
    verified: true,
  }));
  const covered = new Set(verified.map((g) => g.name));
  const declared = TOOL_GROUPS.filter((g) => !covered.has(g.name));
  return [...verified, ...declared];
}

/** Which provider's key would unlock this tool label, connected or not.
 *  Verified picks resolve directly; catalogue picks resolve via their group. */
function providerForTool(label) {
  const live = providerOfModel(label);
  if (live) return live;
  const group = TOOL_GROUPS.find((g) => g.models.includes(label));
  if (!group) return null;
  const hit = Object.entries(PROVIDERS).find(([, p]) => p.label === group.name);
  return hit ? hit[0] : null;
}

const pickerMounts = [];

/** Rebuild every picker in place, keeping any selection that is still offered. */
function rebuildPickers() {
  pickerMounts.forEach((fn) => fn());
}

function setupToolPicker(mountId, hiddenInputId) {
  const mount = $(mountId);
  const hidden = $(hiddenInputId);
  mount.innerHTML = '';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'picker-trigger empty';
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = '<span data-label>Pick your weapon</span><span class="picker-caret">▼</span>';

  const panel = document.createElement('div');
  panel.className = 'picker-panel';
  panel.hidden = true;

  const setValue = (value) => {
    hidden.value = value;
    trigger.querySelector('[data-label]').textContent = value;
    trigger.classList.remove('empty');
    panel.querySelectorAll('.picker-model').forEach((b) => {
      b.classList.toggle('selected', b.dataset.value === value);
    });
    closePanel();
  };

  function closePanel() {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }

  for (const group of pickerGroups()) {
    const wrap = document.createElement('div');
    wrap.className = 'picker-group';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'picker-group-head';
    head.setAttribute('aria-expanded', 'false');
    head.innerHTML =
      `<span>${esc(group.name)}` +
      (group.verified ? ' <span class="verified-tick" title="Verified with your key">✓</span>' : '') +
      `</span><span class="picker-caret">▶</span>`;

    const models = document.createElement('div');
    models.className = 'picker-models';
    models.hidden = true;
    for (const m of group.models) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'picker-model';
      btn.dataset.value = m;
      btn.textContent = m;
      btn.onclick = () => setValue(m);
      models.appendChild(btn);
    }

    head.onclick = () => {
      const open = models.hidden;
      // Accordion: only one provider expanded at a time.
      panel.querySelectorAll('.picker-models').forEach((el) => (el.hidden = true));
      panel.querySelectorAll('.picker-group-head').forEach((el) =>
        el.setAttribute('aria-expanded', 'false')
      );
      models.hidden = !open;
      head.setAttribute('aria-expanded', String(open));
      head.querySelector('.picker-caret').textContent = open ? '▼' : '▶';
    };

    wrap.appendChild(head);
    wrap.appendChild(models);
    panel.appendChild(wrap);
  }

  // Free-text escape hatch for anything not in the list.
  const other = document.createElement('div');
  other.className = 'picker-group';
  other.innerHTML =
    '<div class="picker-group-head" style="cursor:default"><span>Something else</span></div>' +
    '<div class="picker-other"><input type="text" placeholder="e.g. Claude Code + Opus 5" />' +
    '<button type="button" class="btn">Use</button></div>';
  const otherInput = other.querySelector('input');
  const otherBtn = other.querySelector('button');
  otherBtn.onclick = () => {
    const v = otherInput.value.trim();
    if (v) setValue(v);
  };
  otherInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); otherBtn.click(); }
  });
  panel.appendChild(other);

  trigger.onclick = () => {
    const open = panel.hidden;
    document.querySelectorAll('.picker-panel').forEach((p) => (p.hidden = true));
    document.querySelectorAll('.picker-trigger').forEach((t) => t.setAttribute('aria-expanded', 'false'));
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
  };

  // Bound once per mount, not once per rebuild - a key connect rebuilds every
  // picker, and re-adding this each time would pile up dead listeners.
  if (!mount.dataset.outsideBound) {
    mount.dataset.outsideBound = '1';
    document.addEventListener('click', (e) => {
      if (!mount.contains(e.target)) {
        const live = mount.querySelector('.picker-panel');
        const trig = mount.querySelector('.picker-trigger');
        if (live) live.hidden = true;
        if (trig) trig.setAttribute('aria-expanded', 'false');
      }
    });
  }

  mount.appendChild(trigger);
  mount.appendChild(panel);

  // Keep the current choice if it survives a key change.
  if (hidden.value) setValue(hidden.value);
}

// Registering after definition so a rebuild re-runs the whole setup.
function registerPicker(mountId, hiddenInputId) {
  const build = () => setupToolPicker(mountId, hiddenInputId);
  pickerMounts.push(build);
  build();
}

let ws = null;
let state = null; // last snapshot from server
let me = null; // my participant id
let myToken = null; // my resume token, cached in memory alongside `me` - see 'joined' below
let clockOffset = 0; // serverNow - clientNow
let countdownTimer = null;
let revealBuiltFor = null; // phase key the grid was built for
let sentDraft = '';
let lastLobbyListSignature = null;
let revealIndex = 0; // which contestant the voting stage is showing
let lastMyVoteCount = 0;
let celebratedRound = null; // so the confetti fires once, not on every broadcast
let lastRenderedPhase = null;
let lastRosterSignature = null;

// ------------------------------------------------------------ connection ---

function connect(onOpen) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => onOpen && onOpen();
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  ws.onclose = () => showError('Disconnected from server. Reload to reconnect.');
}

function sendMsg(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function showError(text) {
  $('error').textContent = text || '';
}

function onMessage(msg) {
  if (msg.type === 'error') {
    showError(msg.message);
    if (/lobby no longer exists|Session not found/i.test(msg.message)) {
      sessionStorage.removeItem('vibewars');
      myToken = null;
      show('entry');
    }
    return;
  }
  if (msg.type === 'spectating') {
    // Watching is not a seat, so nothing goes into sessionStorage: a reload
    // drops you back to the match list rather than resuming a phantom player.
    me = null;
    myToken = null;
    showError('');
    return;
  }
  if (msg.type === 'stopped_spectating' || msg.type === 'match_over') {
    state = null;
    clearInterval(spectateTimer);
    spectateBuiltFor = null;
    if (msg.reason) showError(msg.reason);
    showWatch();
    return;
  }
  if (msg.type === 'joined') {
    me = msg.participantId;
    myToken = msg.token;
    sessionStorage.setItem(
      'vibewars',
      JSON.stringify({ lobbyId: msg.lobbyId, token: msg.token })
    );
    showError('');
    return;
  }
  if (msg.type === 'left') {
    sessionStorage.removeItem('vibewars');
    state = null;
    me = null;
    myToken = null;
    revealBuiltFor = null;
    clearInterval(countdownTimer);
    $('codeInput').value = '';
    sentDraft = '';
    syncHighlight();
    revealIndex = 0;
    lastMyVoteCount = 0;
    celebratedRound = null;
    lastRenderedPhase = null;
    document.title = 'vibewars - multiplayer vibe coding battles';
    $('winnerBanner').innerHTML = '';
    showChoice(); // back to the create/join fork, not a half-filled form
    showError('');
    show('entry');
    loadLobbies();
    return;
  }
  if (msg.type === 'draft') {
    $('codeInput').value = msg.code || '';
    sentDraft = msg.code || '';
    syncHighlight();
    refreshSandboxPreview();
    return;
  }
  if (msg.type === 'state') {
    clockOffset = msg.serverNow - Date.now();
    state = msg;
    me = msg.you;
    render();
  }
}

function serverNow() {
  return Date.now() + clockOffset;
}

// ---------------------------------------------------------------- render ---

function show(sectionId) {
  for (const s of document.querySelectorAll('section')) {
    s.classList.toggle('visible', s.id === sectionId);
  }
  syncNavChrome();
}

/* On the landing screen the navbar wordmark just repeats the giant title
 * directly beneath it, and the bar's rule cuts the hero in half. So the bar
 * goes bare there - no wordmark, no dividing line - and comes back in full
 * on every other screen, where there is no title to stand in for it. */
function syncNavChrome() {
  const landing =
    $('entry').classList.contains('visible') && !$('entryChoice').hidden;
  document.body.classList.toggle('bare-nav', landing);
}

/* The one "back" control in the app. Every screen that has somewhere to
 * return to calls this with what that means here; screens with nothing to
 * return to (the main menu) call it with no label and the button disappears.
 * The slot itself never moves - only the label and the handler do. */
function setPageBack(label, action) {
  if (!label) {
    $('pageBack').hidden = true;
    $('globalBack').onclick = null;
    return;
  }
  $('pageBack').hidden = false;
  $('globalBackLabel').textContent = label;
  $('globalBack').onclick = action;
}

/** Leaving mid-battle costs real players their fourth, so confirm it; leaving
 *  a lobby that has not started yet, or a solo run nobody else is in, does
 *  not need the interruption. */
function leaveCurrent() {
  const live = state && state.lobby.phase !== 'lobby' && state.lobby.mode !== 'solo';
  if (live && !confirm('Leave this battle?')) return;
  sendMsg({ type: 'leave' });
}

function myParticipant() {
  return state?.participants.find((p) => p.id === me) || null;
}

function render() {
  // Watching is a different job from playing: no seat, no controls, no votes.
  if (state.spectating) return renderSpectate();

  const { lobby, participants } = state;
  const mine = myParticipant();
  const isHost = lobby.hostId === me;
  setPageBack(
    lobby.mode === 'solo' ? (lobby.phase === 'practice' ? 'Back to menu' : 'Leave') : 'Leave lobby',
    leaveCurrent
  );

  // Only animate when the phase actually turns over, not on every broadcast.
  const phaseChanged = lastRenderedPhase !== lobby.phase;
  lastRenderedPhase = lobby.phase;

  // A new build phase means a new battle: clear the conversation and counters
  // before the phase renders, so it sees an unlocked sandbox.
  if (phaseChanged && lobby.phase === 'active') {
    resetSandbox();
    refreshSandboxPreview();
  }
  // Submitting early leaves the round timer running, and it owns the tab title.
  if (lobby.phase !== 'active') clearInterval(countdownTimer);

  if (lobby.phase === 'lobby') {
    show('lobby');
    renderLobby(lobby, participants, isHost);
  } else if (lobby.phase === 'active') {
    show('active');
    renderActive(lobby, mine, isHost);
  } else if (lobby.phase === 'reveal') {
    show('reveal');
    renderReveal(lobby, participants);
  } else if (lobby.phase === 'results') {
    show('results');
    renderResults(lobby, participants);
  } else if (lobby.phase === 'practice') {
    show('practice');
    renderPractice(lobby, mine);
  }

  if (phaseChanged) {
    animateIn(document.querySelector('section.visible'));
    document.querySelector('section.visible').scrollIntoView({ block: 'start' });
  }
}

// --- waiting room ---

function renderLobby(lobby, participants, isHost) {
  const solo = lobby.mode === 'solo';
  $('lobbyHeading').textContent = solo ? 'Practice run' : lobby.name;
  $('lobbyIdOut').textContent = lobby.id;
  $('lobbyCount').textContent = `${participants.length}/${lobby.maxParticipants}`;

  // A practice run has no roster to fill, nobody to invite and no fake players
  // to stand in, so all of that chrome comes off.
  const lobbyOnly = document.querySelectorAll('[data-versus-only]');
  lobbyOnly.forEach((el) => { el.hidden = solo; });
  $('addBotBtn').style.display = solo ? 'none' : '';
  $('allowUnderMin').closest('label').style.display = solo ? 'none' : '';
  if (solo) {
    $('startBtn').textContent = 'Start the clock →';
    return renderSoloSetup(lobby);
  }
  $('startBtn').textContent = 'Start the battle';

  const filled = participants
    .map(
      (p) =>
        `<li><span class="who">${esc(p.name)}</span>` +
        `<span class="chip chip-muted">${esc(p.tool)}</span>` +
        (p.isBot ? '<span class="chip chip-ink">Fake player</span>' : '') +
        (p.verified ? '<span class="chip chip-accent">&#10003; Verified</span>' : '') +
        (p.isHost ? '<span class="chip chip-accent">Host</span>' : '') +
        (p.isYou ? '<span class="chip chip-secondary">You</span>' : '') +
        (p.connected ? '' : '<span class="chip chip-quiet">Disconnected</span>') +
        (p.isBot && isHost
          ? `<button class="btn" data-remove-bot="${p.id}" style="margin-left:auto;padding:4px 10px">Remove</button>`
          : '') +
        '</li>'
    )
    .join('');
  // Show the remaining seats up to the minimum, so the host can see what is missing.
  const emptySlots = Math.max(0, lobby.minParticipants - participants.length);
  const empty = Array.from(
    { length: emptySlots },
    () => '<li class="slot-empty">Waiting for a challenger</li>'
  ).join('');
  $('lobbyParticipants').innerHTML = filled + empty;
  // Stagger only when the roster itself changed, not on every state broadcast.
  const rosterSignature = participants.map((p) => p.id).join(',');
  if (rosterSignature !== lastRosterSignature) {
    lastRosterSignature = rosterSignature;
    animateIn($('lobbyParticipants'), 'anim-stagger');
  }
  $('lobbyParticipants')
    .querySelectorAll('[data-remove-bot]')
    .forEach((btn) => {
      btn.onclick = () =>
        sendMsg({ type: 'remove_bot', participantId: btn.dataset.removeBot });
    });

  // Only the host can shape the roster, and only until the lobby is full.
  const full = participants.length >= lobby.maxParticipants;
  $('rosterControls').style.display = isHost ? 'flex' : 'none';
  $('addBotBtn').disabled = full;
  $('addBotBtn').textContent = full ? 'Lobby full' : '+ Add fake player';

  $('hostSetup').style.display = isHost ? 'block' : 'none';
  $('guestWait').style.display = isHost ? 'none' : 'block';
  if (isHost) {
    syncPromptControls(lobby);
    if (document.activeElement !== $('minutesInput')) {
      $('minutesInput').value = lobby.durationMinutes;
    }
  }
  renderPromptCard($('promptCardLobby'), lobby);
  $('durationOut').textContent = lobby.durationMinutes;
}

let lastPromptTask = null;

/** Practice setup: the brief controls and the clock, and nothing about a roster. */
function renderSoloSetup(lobby) {
  $('lobbyParticipants').innerHTML = '';
  $('rosterControls').style.display = 'none';
  $('hostSetup').style.display = 'block';
  $('guestWait').style.display = 'none';
  syncPromptControls(lobby);
  if (document.activeElement !== $('minutesInput')) {
    $('minutesInput').value = lobby.durationMinutes;
  }
  renderPromptCard($('promptCardLobby'), lobby);
  $('durationOut').textContent = lobby.durationMinutes;
}

/** Render the rolled brief into one of the prompt cards. */
function renderPromptCard(el, lobby) {
  const p = lobby.prompt;
  if (!p) {
    el.innerHTML = '<span class="prompt-tag">Challenge</span><div class="prompt-body">Not rolled yet.</div>';
    return;
  }
  el.innerHTML =
    '<span class="prompt-tag">Challenge</span>' +
    '<div class="prompt-meta">' +
    `<span class="chip chip-secondary">${esc(p.topic)}</span>` +
    `<span class="chip chip-muted">${esc(p.challenge)}</span>` +
    `<span class="chip">${lobby.durationMinutes} min</span>` +
    '</div>' +
    `<p class="prompt-context"><strong>${esc(p.productName)}</strong></p>` +
    '<div class="prompt-task"><span class="prompt-label">Task</span>' +
    `<div class="prompt-task-text">${esc(p.task)}</div></div>` +
    (p.constraints.length
      ? '<span class="prompt-label">Constraints</span>' +
        `<ul class="prompt-constraints">${p.constraints
          .map((c) => `<li>${esc(c)}</li>`)
          .join('')}</ul>`
      : '');

  // Announce a reroll, but do not re-animate on every unrelated broadcast.
  if (p.task !== lastPromptTask) {
    lastPromptTask = p.task;
    el.classList.remove('rolled');
    void el.offsetWidth;
    el.classList.add('rolled');
  }
}

/** Fill the topic/difficulty dropdowns once, then keep them in sync. */
function syncPromptControls(lobby) {
  const topicSel = $('topicSelect');
  if (!topicSel.options.length) {
    topicSel.innerHTML =
      '<option value="RANDOM">Any topic</option>' +
      lobby.topics.map((t) => `<option value="${t}">${esc(t)}</option>`).join('');
  }
  if (document.activeElement !== topicSel) topicSel.value = lobby.topic || 'RANDOM';
}

// --- build phase ---

function renderActive(lobby, mine, isHost) {
  renderPromptCard($('promptCardActive'), lobby);
  // Nobody to race in a practice run, so the roster strip has nothing to say.
  document.querySelector('.work-bar-side').hidden = lobby.mode === 'solo';
  $('forceEndBtn').style.display = isHost ? 'inline-flex' : 'none';
  const locked = !!mine?.submitted;
  $('codeInput').readOnly = locked;
  $('editor').classList.toggle('locked', locked);
  $('submitBtn').disabled = locked;
  $('submitBtn').textContent = locked ? 'Submitted' : 'Submit';
  $('submitStatus').innerHTML = state.participants
    .map(
      (p) =>
        `<span class="chip ${p.submitted ? 'chip-secondary' : 'chip-quiet'}">${esc(p.name)}` +
        `<span>${p.submitted ? 'in' : 'working'}</span></span>`
    )
    .join('');
  $('submitNote').textContent = locked
    ? 'Locked in. Now watch the clock run down on everyone else.'
    : 'Submit early and bank the leftover time - it breaks ties.';
  if (locked) lockSandbox();
  renderSandboxControls();
  startCountdown(lobby);
}

function startCountdown(lobby) {
  clearInterval(countdownTimer);
  const tick = () => {
    const left = Math.max(0, lobby.endsAt - serverNow());
    const mm = String(Math.floor(left / 60000)).padStart(2, '0');
    const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
    $('countdown').textContent = `${mm}:${ss}`;
    $('countdown').classList.toggle('danger', left <= 30000);
    $('countdown').classList.toggle('urgent', left > 0 && left <= 10000);
    // Put the clock in the tab title so it is readable from another tab.
    document.title = `${mm}:${ss} - vibewars`;
    // The server auto-submits the last draft it received, so stop waiting on
    // the 400ms debounce once the buzzer is close: a final edit must not be
    // lost to a timer that never got to fire. flushDraft no-ops when nothing
    // changed, so running it every tick here is free.
    if (left <= 3000) flushDraft();
    if (left <= 0) {
      clearInterval(countdownTimer);
      // Server lock is authoritative; block the UI immediately regardless, and
      // cut off any request still in flight so nothing lands after the buzzer.
      $('codeInput').readOnly = true;
      $('submitBtn').disabled = true;
      lockSandbox();
    }
  };
  tick();
  countdownTimer = setInterval(tick, 250);
}

// --- reveal + voting ---

function renderReveal(lobby, participants) {
  document.title = 'Voting - vibewars';
  renderPromptCard($('promptCardReveal'), lobby);
  $('voteProgress').textContent = `${state.voting.cast}/${state.voting.expected}`;
  $('forceResultsBtn').style.display = lobby.hostId === me ? 'inline-flex' : 'none';

  // Keyed by round as well as roster: a second round reuses the same participant
  // ids, and without the round the grid would keep showing round one's tiles.
  const key = `reveal:${lobby.round}:${participants.map((p) => p.id).join(',')}`;
  if (revealBuiltFor !== key) {
    buildGrid($('grid'), participants, lobby, true);
    $('grid').classList.add('stage');
    revealBuiltFor = key;
    // Open on the first contestant you can actually vote on.
    revealIndex = Math.max(0, participants.findIndex((p) => !p.isYou));
    lastMyVoteCount = Object.keys(state.myVotes).length;
  }

  // Casting a ballot moves you along; other people's votes must not.
  const myVoteCount = Object.keys(state.myVotes).length;
  if (myVoteCount > lastMyVoteCount) {
    const next = nextUnvotedIndex(participants, revealIndex);
    if (next !== -1) revealIndex = next;
  }
  lastMyVoteCount = myVoteCount;
  // Refresh only the vote state, so iframes and in-progress radios survive.
  for (const p of participants) {
    const form = document.querySelector(`[data-vote-form="${p.id}"]`);
    if (!form) continue;
    const voted = state.myVotes[p.id];
    if (voted) {
      form.querySelectorAll('input,button').forEach((el) => (el.disabled = true));
      // Reflect the recorded ballot in the stars, then lock it.
      for (const c of lobby.criteria) {
        const picked = form.querySelector(`input[name="${p.id}-${c}"][value="${voted[c]}"]`);
        if (picked) picked.checked = true;
      }
      form.querySelector('button').textContent = 'Vote locked';
      form.querySelector('[data-vote-status]').textContent =
        'Voted: ' +
        lobby.criteria.map((c) => `${lobby.criteriaLabels[c]} ${voted[c]}/5`).join(' - ');
    }
  }

  showContestant(participants);
}

/** First contestant after `from` that you have not rated yet (-1 if none left). */
function nextUnvotedIndex(participants, from) {
  for (let step = 1; step <= participants.length; step++) {
    const idx = (from + step) % participants.length;
    const p = participants[idx];
    if (!p.isYou && !state.myVotes[p.id]) return idx;
  }
  return -1;
}

/** Reveal is a one-at-a-time stage: show a single tile plus its stepper. */
function showContestant(participants) {
  if (revealIndex >= participants.length) revealIndex = 0;
  const tiles = $('grid').querySelectorAll('.tile');
  tiles.forEach((t, i) => t.classList.toggle('active', i === revealIndex));

  const current = participants[revealIndex];
  $('voteNavCount').textContent = `Contestant ${revealIndex + 1} of ${participants.length}`;
  $('voteNavName').textContent = current ? current.name : '';
  $('prevContestant').disabled = revealIndex === 0;
  $('nextContestant').disabled = revealIndex === participants.length - 1;

  $('voteDots').innerHTML = participants
    .map((p, i) => {
      const cls = [
        'vote-dot',
        i === revealIndex ? 'current' : '',
        p.isYou ? 'self' : state.myVotes[p.id] ? 'voted' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const label = p.isYou ? `${p.name} (you)` : state.myVotes[p.id] ? `${p.name} - voted` : p.name;
      return `<button class="${cls}" data-go="${i}" title="${esc(label)}"></button>`;
    })
    .join('');
  $('voteDots')
    .querySelectorAll('[data-go]')
    .forEach((dot) => {
      dot.onclick = () => {
        revealIndex = Number(dot.dataset.go);
        showContestant(participants);
      };
    });
}

function buildGrid(container, participants, lobby, withVoting) {
  container.innerHTML = '';
  for (const p of participants) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.participant = p.id;

    const head = document.createElement('div');
    head.className = 'tile-head';
    head.innerHTML =
      `<span class="tile-name">${esc(p.name)}</span>` +
      `<span class="tile-tool">${esc(p.tool)}</span>` +
      (p.isYou ? '<span class="chip chip-secondary">You</span>' : '') +
      (p.isBot ? '<span class="chip chip-muted">Fake</span>' : '') +
      (p.verified ? '<span class="chip chip-accent" title="Model confirmed against their own API key">&#10003; Verified</span>' : '') +
      (p.dnf ? '<span class="chip chip-accent">DNF</span>' : '') +
      (p.autoSubmitted ? '<span class="chip chip-muted">Buzzer</span>' : '');
    tile.appendChild(head);

    const frame = document.createElement('iframe');
    // No allow-same-origin: submissions get an opaque origin and cannot touch
    // this page, its localStorage or anyone's API keys. No allow-modals either
    // - a single alert() in a loop would otherwise freeze every voter's tab at
    // exactly the moment they are judging. No allow-popups: nothing being
    // judged has any reason to open a window.
    frame.setAttribute('sandbox', 'allow-scripts allow-forms');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.srcdoc = p.code || '<!-- empty submission -->';
    tile.appendChild(frame);

    if (withVoting && !p.isYou) {
      tile.appendChild(buildVoteForm(p, lobby));
    } else if (withVoting) {
      const note = document.createElement('div');
      note.className = 'tile-foot muted';
      note.textContent = 'Your own work. No marking your own homework.';
      tile.appendChild(note);
    }

    container.appendChild(tile);
  }
}

function buildVoteForm(p, lobby) {
  const form = document.createElement('div');
  form.className = 'tile-foot';
  form.setAttribute('data-vote-form', p.id);

  const criteria = document.createElement('div');
  criteria.className = 'criteria';
  for (const c of lobby.criteria) {
    const row = document.createElement('div');
    row.className = 'criterion';
    // Stars run 5..1 in the DOM and the row is reversed in CSS, so checking one
    // star can fill every lower star with a sibling selector.
    let stars = '';
    for (let v = 5; v >= 1; v--) {
      const id = `${p.id}-${c}-${v}`;
      stars +=
        `<input type="radio" id="${id}" name="${p.id}-${c}" value="${v}" />` +
        `<label for="${id}" title="${v} of 5">&#9733;</label>`;
    }
    row.innerHTML =
      `<span class="criterion-name">${esc(lobby.criteriaLabels[c])}</span>` +
      `<span class="stars">${stars}</span>`;
    criteria.appendChild(row);
  }
  form.appendChild(criteria);

  const btn = document.createElement('button');
  btn.className = 'btn btn-primary btn-block';
  btn.style.marginTop = '14px';
  btn.textContent = 'Submit vote';
  btn.onclick = () => {
    const scores = {};
    for (const c of lobby.criteria) {
      const picked = form.querySelector(`input[name="${p.id}-${c}"]:checked`);
      if (!picked) return showError(`Rate ${lobby.criteriaLabels[c]} for ${p.name}.`);
      scores[c] = Number(picked.value);
    }
    showError('');
    sendMsg({ type: 'vote', targetId: p.id, scores });
  };
  form.appendChild(btn);

  const status = document.createElement('div');
  status.setAttribute('data-vote-status', '');
  status.className = 'vote-status';
  form.appendChild(status);

  return form;
}

// --- leaderboard ---

/** Winner banner above the leaderboard, with a one-shot confetti burst. */
/** The winner banner on its own. Shared with the spectator view, which wants
 *  the banner but not the confetti - that is the players' moment, not a
 *  watcher's. */
function renderWinnerInto(banner, rows) {
  const winner = rows[0];
  if (!winner) {
    banner.innerHTML = '';
    return null;
  }
  const tied = rows[1] && Math.abs(rows[1].total - winner.total) < 1e-9;
  const scored = winner.total > 0;

  banner.innerHTML =
    '<div class="winner">' +
    '<span class="winner-spark">&#10022;</span>' +
    '<span class="winner-spark">&#10022;</span>' +
    '<span class="winner-spark">&#10022;</span>' +
    `<div class="winner-label">&#10022; ${scored ? 'Winner' : 'Nobody scored'}</div>` +
    `<h3 class="winner-name">${esc(winner.name)}</h3>` +
    '<div class="winner-meta">' +
    `<span class="winner-score">${winner.total.toFixed(2)}</span>` +
    `<span class="chip chip-ink">${esc(winner.tool)}</span>` +
    (tied
      ? '<span class="winner-note">Won on tiebreak: higher Requirements Met, then time left at submit.</span>'
      : '') +
    '</div></div>';

  return scored;
}

function renderWinner(lobby, rows) {
  const scored = renderWinnerInto($('winnerBanner'), rows);
  // Once per round, and never for a round where nobody actually scored.
  const key = `${lobby.id}:${lobby.round}`;
  if (celebratedRound !== key && scored) {
    celebratedRound = key;
    fireConfetti();
  }
}

/* ------------------------------------------------------------ practice -- *
 * Solo runs end here. There is nothing to score and nobody to score it, so the
 * screen is just the brief and what you actually built against it. */
function renderPractice(lobby, mine) {
  document.title = 'Practice done - vibewars';
  renderPromptCard($('promptCardPractice'), lobby);
  const code = (mine && mine.code) || '';
  const blank = !code.trim();

  $('practiceMeta').textContent = blank
    ? 'Nothing submitted'
    : `${code.length.toLocaleString()} characters`;
  $('practiceNote').textContent = blank
    ? 'The clock beat you and the editor was empty. No shame, the brief is rolled fresh every time.'
    : 'Unscored and unrecorded, which is the point of practice. Read it back, then go again.';
  $('practiceFrame').srcdoc = code || '<!-- nothing built -->';
}

/* ------------------------------------------------------------ watching -- *
 * A read-only view of somebody else's match. During the build phase the server
 * sends each player's live draft on a tick; afterwards the same renderers the
 * players see are reused, minus every control. */
function renderSpectate() {
  const { lobby, participants } = state;
  show('spectate');
  setPageBack('Stop watching', () => sendMsg({ type: 'stop_spectate' }));

  const watching = state.spectators || 0;
  $('spectateTitle').innerHTML =
    (lobby.phase === 'active' ? '<span class="live-dot"></span>' : '') + esc(lobby.name);
  $('spectateStatus').textContent =
    `${PHASE_WORDS[lobby.phase] || lobby.phase} · ${participants.length} building · ` +
    `${watching} watching`;
  renderPromptCard($('promptCardSpectate'), lobby);

  const clock = $('spectateClock');
  if (lobby.phase === 'active') {
    clock.hidden = false;
    startSpectateClock(lobby);
  } else {
    clock.hidden = true;
    clearInterval(spectateTimer);
  }

  const showBoard = lobby.phase === 'results' && state.leaderboard;
  $('spectateScoresCard').hidden = !showBoard;
  if (showBoard) renderSpectateBoard(lobby, state.leaderboard);
  $('spectateWinner').innerHTML = '';
  if (showBoard) renderWinnerInto($('spectateWinner'), state.leaderboard);

  $('spectateGridTitle').textContent =
    lobby.phase === 'active' ? 'Builds, live' : 'Submissions';
  buildSpectateGrid(lobby, participants);
  document.title =
    (lobby.phase === 'active' ? 'Watching - ' : 'Watched - ') + lobby.name + ' - vibewars';
}

const PHASE_WORDS = {
  lobby: 'Waiting to start',
  active: 'Building now',
  reveal: 'Voting',
  results: 'Finished',
};

let spectateTimer = null;
function startSpectateClock(lobby) {
  clearInterval(spectateTimer);
  const tick = () => {
    const left = Math.max(0, lobby.endsAt - serverNow());
    const mm = String(Math.floor(left / 60000)).padStart(2, '0');
    const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
    $('spectateClock').textContent = `${mm}:${ss} left`;
    if (left <= 0) clearInterval(spectateTimer);
  };
  tick();
  spectateTimer = setInterval(tick, 250);
}

function renderSpectateBoard(lobby, rows) {
  const header =
    '<tr><th>#</th><th>Name</th><th>Tool</th>' +
    lobby.criteria.map((c) => `<th>${esc(lobby.criteriaLabels[c])}</th>`).join('') +
    '<th>Total</th></tr>';
  $('spectateBoard').innerHTML =
    header +
    rows
      .map(
        (r, i) =>
          `<tr class="rank-${i + 1}"><td>${i + 1}</td>` +
          `<td>${esc(r.name)}${r.dnf ? ' <span class="chip chip-accent">DNF</span>' : ''}</td>` +
          `<td>${esc(r.tool)}</td>` +
          lobby.criteria.map((c) => `<td>${r.averages[c].toFixed(2)}</td>`).join('') +
          `<td class="total">${r.total.toFixed(2)}</td></tr>`
      )
      .join('');
}

/* Tiles are rebuilt only when the roster or phase changes; the iframes are
 * updated in place on every tick so a live build does not flicker. */
let spectateBuiltFor = null;
function buildSpectateGrid(lobby, participants) {
  const host = $('spectateGrid');
  const key = `${lobby.id}:${lobby.round}:${lobby.phase}:${participants.map((p) => p.id).join(',')}`;
  if (spectateBuiltFor !== key) {
    spectateBuiltFor = key;
    host.innerHTML = '';
    for (const p of participants) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.spectateTile = p.id;
      tile.innerHTML =
        '<div class="tile-head">' +
        `<span class="tile-name">${esc(p.name)}</span>` +
        `<span class="tile-tool">${esc(p.tool)}</span>` +
        (p.isBot ? '<span class="chip chip-muted">Fake</span>' : '') +
        (p.verified ? '<span class="chip chip-accent">&#10003; Verified</span>' : '') +
        '<span class="chip chip-quiet" data-tile-status></span>' +
        '</div>';
      const frame = document.createElement('iframe');
      // Same isolation as every other rendering of untrusted submissions.
      frame.setAttribute('sandbox', 'allow-scripts allow-forms');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.dataset.spectateFrame = p.id;
      tile.appendChild(frame);
      host.appendChild(tile);
    }
    animateIn(host, 'anim-stagger');
  }

  for (const p of participants) {
    const frame = host.querySelector(`[data-spectate-frame="${p.id}"]`);
    const status = host.querySelector(`[data-spectate-tile="${p.id}"] [data-tile-status]`);
    if (!frame) continue;
    const live = state.drafts ? state.drafts[p.id] : undefined;
    const code = lobby.phase === 'active' ? live || '' : p.code || '';
    // Reassigning srcdoc reloads the frame, so only do it when it changed.
    if (frame.dataset.rendered !== code) {
      frame.dataset.rendered = code;
      frame.srcdoc = code || '<!-- nothing yet -->';
    }
    if (status) {
      status.textContent =
        lobby.phase === 'active'
          ? p.submitted
            ? 'Locked in'
            : code.trim()
              ? 'Building'
              : 'Blank so far'
          : p.dnf
            ? 'DNF'
            : p.autoSubmitted
              ? 'Buzzer'
              : 'Submitted';
    }
  }
}

function renderResults(lobby, participants) {
  const rows = state.leaderboard || [];
  renderWinner(lobby, rows);
  const header =
    '<tr><th>#</th><th>Name</th><th>Tool</th>' +
    lobby.criteria.map((c) => `<th>${esc(lobby.criteriaLabels[c])}</th>`).join('') +
    '<th>Total</th><th>Voters</th></tr>';
  const body = rows
    .map(
      (r, i) =>
        `<tr class="rank-${i + 1}"><td>${i + 1}</td>` +
        `<td>${esc(r.name)}${r.dnf ? ' <span class="chip chip-accent">DNF</span>' : ''}</td>` +
        `<td>${esc(r.tool)}</td>` +
        lobby.criteria.map((c) => `<td>${r.averages[c].toFixed(2)}</td>`).join('') +
        `<td class="total">${r.total.toFixed(2)}</td><td>${r.voterCount}</td></tr>`
    )
    .join('');
  $('leaderboard').innerHTML = header + body;
  document.title = rows[0] ? `${rows[0].name} wins - vibewars` : 'Results - vibewars';
  $('resetBtn').style.display = lobby.hostId === me ? 'inline-flex' : 'none';
  $('grid').classList.remove('stage'); // results shows everything at once again
  buildGrid($('resultsGrid'), participants, lobby, false);

  if (rows[0] && rows[0].total > 0) {
    const tile = $('resultsGrid').querySelector(`[data-participant="${rows[0].participantId}"]`);
    if (tile) {
      const chip = document.createElement('span');
      chip.className = 'chip chip-accent';
      chip.innerHTML = '&#10022; Winner';
      tile.querySelector('.tile-head').appendChild(chip);
    }
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

// ----------------------------------------------------------------- wiring ---

/* ---------------------------------------------------------- identity -- *
 * Anonymous and passwordless, the same shape uiwars uses: a random id and a
 * generated nickname kept in localStorage. No accounts, no email, nothing to
 * recover. localStorage rather than sessionStorage so you keep the same name
 * across tabs and visits; a lobby seat is still per-tab. */

const ADJECTIVES = [
  'PIXEL', 'VECTOR', 'ROGUE', 'SOLAR', 'HYPER', 'NEON', 'OMEGA', 'TURBO',
  'GHOST', 'CYBER', 'ATOMIC', 'RAPID', 'ULTRA', 'VOID', 'QUANTUM', 'CHROME',
  'FERAL', 'LUCID', 'NOCTURNE', 'PRISM',
];
const NOUNS = [
  'SHARK', 'WIZARD', 'TITAN', 'STORM', 'FORGE', 'BLADE', 'WOLF', 'FALCON',
  'VIPER', 'COMET', 'RACER', 'HUNTER', 'RAVEN', 'ECHO', 'ORACLE', 'NOMAD',
  'CIPHER', 'DRIFTER', 'MONOLITH', 'PHANTOM',
];

function generateNickname() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}_${noun}${Math.floor(Math.random() * 99) + 1}`;
}

const IDENTITY_KEY = 'vibewars_identity';
let identity = null;

function loadIdentity() {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.playerId && parsed.nickname) return parsed;
    }
  } catch (e) {
    /* corrupt or unavailable storage: fall through and mint a new one */
  }
  return null;
}

function saveIdentity(next) {
  identity = next;
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(next));
  } catch (e) {
    /* private browsing: the identity just lasts for this page */
  }
  renderIdentity();
}

function ensureIdentity() {
  identity = loadIdentity() || {
    playerId:
      (crypto.randomUUID && crypto.randomUUID()) ||
      String(Date.now()) + Math.random().toString(36).slice(2),
    nickname: generateNickname(),
  };
  saveIdentity(identity);
}

function setNickname(name) {
  const clean = String(name || '').trim().slice(0, 20);
  if (!clean) return false;
  saveIdentity({ ...identity, nickname: clean });
  return true;
}

function renderIdentity() {
  if (!identity) return;
  const nameEl = $('identityName');
  if (nameEl) nameEl.textContent = identity.nickname;
  // Keep the name the wizard will submit in step with the stored one.
  for (const id of ['createName', 'joinName', 'soloName']) {
    const input = $(id);
    if (input && document.activeElement !== input) input.value = identity.nickname;
  }
}

/* ---------------------------------------------------------- info pages -- *
 * Rules, scoring, keys, sponsor and about are real pages like everything
 * else in the app, not an overlay - opening one takes over the screen, and
 * the unified back control returns to wherever it was opened from, including
 * a battle in progress (which keeps running the whole time; see
 * rememberView() below). The hash keeps them linkable, which matters once
 * this is public. */

/* ------------------------------------------------------- how to play -- *
 * A walkthrough rather than a wall of text: one idea per screen, Next and Back,
 * and a dot row you can jump around with. Offered once on a first visit. */

const GUIDE_SEEN = 'vibewars_guide_seen';

const GUIDE_STEPS = [
  {
    title: 'One brief, dealt to everyone',
    body:
      'A lobby holds four to six players. Inside it you play battles - one round each. Nobody ' +
      'writes the brief: the host picks a topic and the server deals a product, a task, and ' +
      'usually one deliberately annoying constraint.',
    art: `<rect x="14" y="18" width="92" height="64" rx="8" class="g-surface"/>
          <rect x="26" y="32" width="46" height="7" rx="3.5" class="g-accent"/>
          <rect x="26" y="46" width="68" height="6" rx="3" class="g-line"/>
          <rect x="26" y="58" width="54" height="6" rx="3" class="g-line"/>
          <circle cx="96" cy="26" r="4" class="g-accent"/>`,
  },
  {
    title: 'Declare what you are building with',
    body:
      'Pick the model or tool you will actually use. The next step offers to take a key for it: ' +
      'connect one and vibewars asks that provider what you can reach, so your pick is verified ' +
      'rather than just claimed, and you can prompt it from inside the game. Skipping is fine - ' +
      'you just paste your HTML in by hand instead.',
    art: `<rect x="14" y="26" width="92" height="20" rx="10" class="g-surface"/>
          <rect x="14" y="54" width="92" height="20" rx="10" class="g-surface"/>
          <circle cx="28" cy="36" r="5" class="g-accent"/>
          <circle cx="28" cy="64" r="5" class="g-line"/>
          <path d="M84 32l5 5 9-10" class="g-stroke"/>`,
  },
  {
    title: 'Build against the clock',
    body:
      'Prompt your model right there in the sandbox. It already has the brief, so ask for what ' +
      'you want and watch it render live - or paste your own HTML into the editor. One file, no ' +
      'frameworks, no build step. Submitting early banks the time you had left, which settles ties.',
    art: `<rect x="14" y="18" width="92" height="64" rx="8" class="g-surface"/>
          <rect x="24" y="30" width="30" height="6" rx="3" class="g-accent"/>
          <rect x="24" y="42" width="58" height="5" rx="2.5" class="g-line"/>
          <rect x="24" y="52" width="44" height="5" rx="2.5" class="g-line"/>
          <rect x="24" y="62" width="62" height="5" rx="2.5" class="g-line"/>`,
  },
  {
    title: 'The buzzer is merciless',
    body:
      'At zero everything locks. Whatever is in your editor is submitted for you, so half-finished ' +
      'still counts - it just banks no time. An empty editor is a DNF, and a DNF still gets voted on.',
    art: `<circle cx="60" cy="50" r="30" class="g-ring"/>
          <path d="M60 50V30" class="g-stroke"/>
          <path d="M60 50l14 10" class="g-accent-stroke"/>
          <circle cx="60" cy="50" r="3.5" class="g-accent"/>`,
  },
  {
    title: 'Everything is revealed',
    body:
      'Every submission renders live in its own sandbox, one contestant at a time, labelled with ' +
      'who wrote it and what they used. Step through with Back and Next - the same way you are ' +
      'moving through this guide.',
    art: `<rect x="10" y="24" width="58" height="52" rx="7" class="g-surface"/>
          <rect x="74" y="34" width="36" height="32" rx="6" class="g-line-fill"/>
          <rect x="20" y="36" width="30" height="6" rx="3" class="g-accent"/>
          <rect x="20" y="48" width="38" height="5" rx="2.5" class="g-line"/>
          <rect x="20" y="58" width="24" height="5" rx="2.5" class="g-line"/>`,
  },
  {
    title: 'Score everyone but yourself',
    body:
      'Four criteria, five stars each: Requirements Met, Functionality, Aesthetic and Approach. ' +
      'Each is averaged across your voters and the four averages are added, so 20.00 is perfect. ' +
      'One ballot per person, no changes after.',
    art: `<path d="M32 40l4 8 9 1-6.5 6 1.5 9-8-4.5-8 4.5 1.5-9-6.5-6 9-1z" class="g-accent"/>
          <path d="M64 40l4 8 9 1-6.5 6 1.5 9-8-4.5-8 4.5 1.5-9-6.5-6 9-1z" class="g-accent"/>
          <path d="M96 40l4 8 9 1-6.5 6 1.5 9-8-4.5-8 4.5 1.5-9-6.5-6 9-1z" class="g-line"/>`,
  },
];

let guideIndex = 0;

function renderGuide() {
  const host = $('guide');
  if (!host) return;
  const step = GUIDE_STEPS[guideIndex];
  const last = guideIndex === GUIDE_STEPS.length - 1;

  host.innerHTML =
    '<div class="guide-art"><svg viewBox="0 0 120 100" aria-hidden="true">' + step.art + '</svg></div>' +
    `<p class="guide-count">Step ${guideIndex + 1} of ${GUIDE_STEPS.length}</p>` +
    `<h3 class="guide-title">${esc(step.title)}</h3>` +
    `<p class="guide-body">${esc(step.body)}</p>` +
    '<div class="guide-dots">' +
    GUIDE_STEPS.map(
      (_, i) => `<button class="guide-dot${i === guideIndex ? ' current' : ''}" data-go="${i}"></button>`
    ).join('') +
    '</div>' +
    '<div class="guide-nav">' +
    `<button class="btn" data-guide="back"${guideIndex === 0 ? ' disabled' : ''}>&#8592; Back</button>` +
    `<button class="btn btn-primary" data-guide="${last ? 'done' : 'next'}">` +
    (last ? 'Got it, let me play' : 'Next &#8594;') +
    '</button></div>';

  host.querySelector('[data-guide="back"]').onclick = () => {
    if (guideIndex > 0) { guideIndex--; renderGuide(); }
  };
  const fwd = host.querySelector('[data-guide="next"], [data-guide="done"]');
  fwd.onclick = () => {
    if (last) { markGuideSeen(); closePage(); }
    else { guideIndex++; renderGuide(); }
  };
  host.querySelectorAll('[data-go]').forEach((d) => {
    d.onclick = () => { guideIndex = Number(d.dataset.go); renderGuide(); };
  });
}

function markGuideSeen() {
  try {
    localStorage.setItem(GUIDE_SEEN, '1');
  } catch (e) {
    /* nothing to remember it with; the guide just offers again */
  }
}

/** First-timers get the walkthrough once, without being trapped in it. */
function maybeOfferGuide() {
  let seen = null;
  try {
    seen = localStorage.getItem(GUIDE_SEEN);
  } catch (e) {
    seen = '1'; // no storage: do not nag on every load
  }
  if (!seen && !location.hash) {
    guideIndex = 0;
    openPage('how');
  }
}

const PAGES = {
  how: {
    title: 'How to play',
    template: 'page-how',
    onOpen: () => { renderGuide(); markGuideSeen(); },
  },
  scoring: { title: 'Scoring', template: 'page-scoring' },
  leaderboard: { title: 'Leaderboard', template: 'page-leaderboard', onOpen: () => renderGlobalBoard() },
  keys: { title: 'Your API keys', template: 'page-keys', onOpen: () => renderKeyList() },
  sponsor: { title: 'Sponsor vibewars', template: 'page-sponsor' },
  about: { title: 'About vibewars', template: 'page-about' },
};

/** All-time standings by declared model, from the battle archive. */
async function renderGlobalBoard() {
  const host = $('globalBoard');
  if (!host) return;
  host.innerHTML = '<p class="muted">Fetching the standings&#8230;</p>';
  let data = null;
  try {
    const res = await fetch('/api/stats');
    if (res.ok) data = await res.json();
  } catch (e) {
    /* offline or no archive: the empty state below covers it */
  }
  if (!data || !data.enabled || !data.tools || !data.tools.length) {
    host.innerHTML =
      '<p class="muted">&#127942; Nothing on the board yet. Win a battle and put your model here.</p>';
    return;
  }
  host.innerHTML =
    '<div class="table-scroll"><table>' +
    '<tr><th>#</th><th>Model / tool</th><th>Wins</th><th>Battles</th><th>Avg total</th></tr>' +
    data.tools
      .map(
        (t, i) =>
          '<tr class="' + (i === 0 ? 'rank-1' : '') + '"><td>' + (i + 1) + '</td>' +
          // These are COUNT aggregates from a view, but they arrive over HTTP
          // like anything else, so coerce rather than trust the shape.
          '<td>' + esc(t.tool) + '</td><td>' + (Number(t.wins) || 0) + '</td>' +
          '<td>' + (Number(t.battles) || 0) + '</td>' +
          '<td class="total">' + Number(t.avg_total).toFixed(2) + '</td></tr>'
      )
      .join('') +
    '</table></div>' +
    '<p class="muted" style="margin-top:14px">Humans only - stand-ins are not counted. ' +
    'Ranked by wins, then average total.</p>';
}

/** Render one row per provider: add a key, or show what it unlocked. */
function renderKeyList() {
  const list = $('keyList');
  if (!list) return;
  const keys = storedKeys();
  const models = verifiedModels();

  list.innerHTML = Object.entries(PROVIDERS)
    .map(([id, p]) => {
      const connected = !!keys[id];
      const found = models[id] || [];
      return (
        `<div class="key-row" data-provider="${id}">` +
        `<div class="key-row-head"><span class="key-name">${esc(p.label)}</span>` +
        (connected
          ? `<span class="chip chip-accent">Connected</span>`
          : `<span class="chip chip-quiet">Not connected</span>`) +
        (!connected && houseConfig.house[id]
          ? `<span class="chip chip-quiet">House key available</span>`
          : '') +
        '</div>' +
        `<p class="key-hint">${esc(p.hint)}</p>` +
        (connected
          ? `<div class="key-form"><button class="btn" data-remove="${id}">Remove key</button></div>` +
            `<p class="key-models">${found.length} model${found.length === 1 ? '' : 's'} available: ` +
            `${esc(found.slice(0, 6).map((m) => m.label).join(', '))}${found.length > 6 ? ', …' : ''}</p>`
          : `<div class="key-form">` +
            `<input type="password" autocomplete="off" spellcheck="false" data-key-input="${id}" placeholder="Paste key" />` +
            `<button class="btn btn-primary" data-connect="${id}">Connect</button></div>`) +
        `<p class="key-status" data-status="${id}"></p>` +
        '</div>'
      );
    })
    .join('');

  list.querySelectorAll('[data-connect]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.connect;
      const input = list.querySelector(`[data-key-input="${id}"]`);
      const status = list.querySelector(`[data-status="${id}"]`);
      const key = input.value.trim();
      if (!key) {
        status.className = 'key-status bad';
        status.textContent = 'Paste a key first.';
        return;
      }
      btn.disabled = true;
      status.className = 'key-status';
      status.textContent = 'Checking with the provider…';
      try {
        const found = await addKey(id, key);
        input.value = ''; // do not leave it sitting in the DOM
        rebuildPickers();
        renderKeyList();
        const s2 = list.querySelector(`[data-status="${id}"]`);
        if (s2) {
          s2.className = 'key-status ok';
          s2.textContent = `Connected. ${found.length} models unlocked.`;
        }
      } catch (err) {
        btn.disabled = false;
        status.className = 'key-status bad';
        status.textContent = err.message;
      }
    };
  });

  list.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.onclick = () => {
      removeKey(btn.dataset.remove);
      rebuildPickers();
      renderKeyList();
    };
  });
}

/* Info pages are a real section like everything else, not an overlay - which
 * means something has to remember what was on screen before one opened, so
 * Back can put it back: the exact wizard step with its fields still filled,
 * the watch list, or a battle in progress that kept running the whole time.
 * Captured as a closure rather than a snapshot, because replaying "call the
 * function that built this screen" is simpler than reconstructing DOM state
 * by hand, and every one of those functions already sets up its own
 * pageBack label as a side effect. */
let returnToView = null;
let onInfoPage = false;

function rememberView() {
  if (state) {
    // The game kept running underneath - state is still live, so redrawing
    // it is exactly what the next server broadcast would have done anyway.
    returnToView = () => (state.spectating ? renderSpectate() : render());
    return;
  }
  const section = document.querySelector('section.visible')?.id;
  // show('infoPage') un-marks every other section, .entry included, so every
  // path back through the entry section has to re-mark it - showChoice/
  // showPlay/startFlow only toggle their own sub-divs and otherwise assume
  // the section is already on screen, because until now every caller that
  // reaches them was already inside #entry.
  if (section === 'watch') {
    returnToView = showWatch;
  } else if (section === 'entry' && !$('entryWizard').hidden) {
    // wizFlow/wizIndex persist while the info page is open, and the wizard's
    // own inputs are only hidden, not destroyed - re-running startFlow with
    // the same values redraws the exact step the player was on.
    const flow = wizFlow, index = wizIndex;
    returnToView = () => { show('entry'); startFlow(flow, index); };
  } else if (section === 'entry' && !$('playScreen').hidden) {
    returnToView = () => { show('entry'); showPlay(); };
  } else if (section === 'entry' && !$('multiplayerScreen').hidden) {
    returnToView = () => { show('entry'); showMultiplayer(); };
  } else {
    returnToView = () => { show('entry'); showChoice(); };
  }
}

function openPage(key) {
  const page = PAGES[key];
  if (!page) return;
  if (!onInfoPage) rememberView(); // switching between info pages keeps the original return point
  onInfoPage = true;
  $('infoPageTitle').textContent = page.title;
  $('infoPageBody').innerHTML = '';
  $('infoPageBody').appendChild($(page.template).content.cloneNode(true));
  if (page.onOpen) page.onOpen();
  show('infoPage');
  // "Back" rather than a screen-specific label: whatever it returns to (a
  // live battle, the watch list, the menu) will set its own correct label
  // the moment it renders.
  setPageBack(state ? 'Back' : 'Menu', closePage);
  if (location.hash !== '#' + key) history.pushState(null, '', '#' + key);
}

function closePage() {
  onInfoPage = false;
  const restore = returnToView;
  returnToView = null;
  if (restore) restore();
  else { show('entry'); showChoice(); } // rememberView() never ran - fall back to the root
  if (location.hash) history.pushState(null, '', location.pathname);
}

document.querySelectorAll('[data-page]').forEach((el) => {
  el.onclick = () => openPage(el.dataset.page);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.querySelector('section.visible')?.id === 'infoPage') closePage();
});
window.addEventListener('popstate', () => {
  const key = location.hash.slice(1);
  if (PAGES[key]) openPage(key);
  else if (document.querySelector('section.visible')?.id === 'infoPage') closePage();
});
// A cold load of /#scoring should land on that page, not just the front screen.
if (PAGES[location.hash.slice(1)]) openPage(location.hash.slice(1));

/* -------------------------------------------------------------- theming -- */

function applyTheme(theme) {
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  // Moon while dark (tap for light), sun while light.
  $('themeToggle').textContent = theme === 'light' ? '☀' : '☾';
  try {
    localStorage.setItem('vibewars-theme', theme);
  } catch (e) {}
}

$('themeToggle').onclick = () => {
  const nowLight = document.documentElement.getAttribute('data-theme') === 'light';
  applyTheme(nowLight ? 'dark' : 'light');
};

(() => {
  let saved = null;
  try {
    saved = localStorage.getItem('vibewars-theme');
  } catch (e) {}
  applyTheme(saved === 'light' ? 'light' : 'dark'); // dark unless asked otherwise
})();

/* ------------------------------------------------------------- motion -- */

/** Replay an entrance animation (re-adding the class restarts it). */
function animateIn(el, cls = 'anim-in') {
  if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.classList.remove(cls);
  void el.offsetWidth; // force reflow so the animation restarts
  el.classList.add(cls);
}

/* --------------------------------------------------------- entry wizard -- *
 * Two forms side by side is a wall of fields. Instead: pick create or join,
 * then answer one question per screen. */

const FLOWS = {
  create: {
    title: 'Create a lobby',
    submitLabel: 'Open the lobby &#8599;',
    send: () => {
      setNickname($('createName').value);
      sendMsg({
        type: 'create',
        lobbyName: $('createLobbyName').value,
        name: $('createName').value,
        tool: $('createTool').value,
        verified: !!providerOfModel($('createTool').value),
        playerId: identity.playerId,
      });
    },
  },
  join: {
    title: 'Join a lobby',
    submitLabel: 'Get me in &#8599;',
    send: () => {
      setNickname($('joinName').value);
      sendMsg({
        type: 'join',
        lobbyId: $('joinLobbyId').value,
        name: $('joinName').value,
        tool: $('joinTool').value,
        verified: !!providerOfModel($('joinTool').value),
        playerId: identity.playerId,
      });
    },
  },
  solo: {
    title: 'Practice run',
    submitLabel: 'Start practising &#8599;',
    send: () => {
      setNickname($('soloName').value);
      sendMsg({
        type: 'solo',
        name: $('soloName').value,
        tool: $('soloTool').value,
        verified: !!providerOfModel($('soloTool').value),
        playerId: identity.playerId,
      });
    },
  },
};

let wizFlow = null;
let wizIndex = 0;

const wizSteps = () => [...document.querySelectorAll(`.wiz-step[data-flow="${wizFlow}"]`)];

function showChoice() {
  wizFlow = null;
  $('entryWizard').hidden = true;
  $('playScreen').hidden = true;
  $('entryChoice').hidden = false;
  showError('');
  syncNavChrome();
  setPageBack(null, null); // the main menu is the root - nowhere further back
}

function showPlay() {
  wizFlow = null;
  $('entryWizard').hidden = true;
  $('entryChoice').hidden = true;
  $('multiplayerScreen').hidden = true;
  $('playScreen').hidden = false;
  showError('');
  syncNavChrome();
  setPageBack('Menu', showChoice);
}

function showMultiplayer() {
  wizFlow = null;
  $('entryWizard').hidden = true;
  $('entryChoice').hidden = true;
  $('playScreen').hidden = true;
  $('multiplayerScreen').hidden = false;
  showError('');
  syncNavChrome();
  loadLobbies();
  setPageBack('Menu', showPlay);
}

function startFlow(flow, atIndex = 0) {
  wizFlow = flow;
  wizIndex = atIndex;
  $('entryChoice').hidden = true;
  $('playScreen').hidden = true;
  $('multiplayerScreen').hidden = true;
  $('entryWizard').hidden = false;
  showError('');
  syncNavChrome();
  renderWizard();
  // Solo is opened from the play fork, so backing out of it lands there;
  // create/join are opened from the multiplayer screen, so backing out
  // lands there.
  setPageBack('Menu', flow === 'solo' ? showPlay : showMultiplayer);
}

function renderWizard() {
  const steps = wizSteps();
  const meta = FLOWS[wizFlow];
  $('wizTitle').textContent = meta.title;
  $('wizStepNum').textContent = wizIndex + 1;
  $('wizStepTotal').textContent = steps.length;
  $('wizProgress').innerHTML = steps
    .map((_, i) => `<span class="${i <= wizIndex ? 'done' : ''}"></span>`)
    .join('');

  document.querySelectorAll('.wiz-step').forEach((s) => s.classList.remove('active'));
  const step = steps[wizIndex];
  step.classList.add('active');

  // The key step is built fresh each time: the answer depends on the weapon
  // picked on the step before, which you can go back and change.
  const resolved = step.dataset.keystep ? renderKeyStep(step.dataset.keystep) : false;

  // Direct child only, so the picker's own "something else" field is not read.
  const input = step.querySelector(':scope > input[type="text"]');
  // An optional step you have not answered says Skip, so it is obvious you can
  // move on without it. Once answered it reads Continue like any other step.
  const answered = step.dataset.keystep ? resolved : !!(input && input.value.trim());
  const last = wizIndex === steps.length - 1;
  $('wizNext').innerHTML = last
    ? meta.submitLabel
    : step.dataset.optional === 'true' && !answered
      ? 'Skip &#8594;'
      : 'Continue &#8594;';
  $('wizBack').textContent = '← Back';

  // Focus the field so you can just keep typing and hitting enter.
  if (input) setTimeout(() => input.focus(), 0);
}

/* The key step sits right after the weapon pick, where the reason for it is
 * obvious. It never blocks: Continue always moves on, because a player without
 * a key can still paste HTML and compete. Returns true when there is nothing
 * left to do here, which is what turns "Skip" into "Continue". */
function renderKeyStep(flow) {
  const host = $(flow + 'KeyStep');
  const tool = $(flow + 'Tool').value;
  const provider = providerForTool(tool);

  // Something with no API behind it - a CLI, an IDE, an agent. Nothing to ask for.
  if (!provider) {
    host.innerHTML =
      '<p class="key-step-none">No key needed for <strong>' + esc(tool || 'that') +
      '</strong> - it does not run through an API we can call. Build in it however you like, ' +
      'then paste the HTML into the editor.</p>';
    return true;
  }

  const label = PROVIDERS[provider].label;
  const connected = !!storedKeys()[provider];

  if (connected) {
    const models = verifiedModels()[provider] || [];
    const picked = models.some((m) => m.label === tool);
    host.innerHTML =
      '<p class="key-step-ok"><span class="key-tick">&#10003;</span> ' + esc(label) +
      ' is connected. ' + models.length + ' model' + (models.length === 1 ? '' : 's') +
      ' unlocked.</p>' +
      (picked
        ? '<p class="key-step-note">You are set - prompting is live in the sandbox.</p>'
        : '<p class="key-step-note">Your pick <strong>' + esc(tool) + '</strong> is not one the ' +
          'provider actually offers, so prompting stays off. Swap to a real one:</p>' +
          '<div class="key-swap">' +
          models
            .slice(0, 8)
            .map((m) => '<button type="button" class="key-model" data-pick="' + esc(m.label) +
                        '">' + esc(m.label) + '</button>')
            .join('') +
          '</div>');

    host.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.onclick = () => {
        setToolValue(flow, btn.dataset.pick);
        renderWizard(); // repaints this step and the Skip/Continue label
      };
    });
    return true;
  }

  const houseNote = houseConfig.house[provider]
    ? '<p class="key-step-note">This one is already covered: skip this and the sandbox still works, ' +
      'using the house key on this instance for a shared, capped number of prompts per round. ' +
      'Connect your own for no cap.</p>'
    : '';

  host.innerHTML =
    houseNote +
    '<p class="key-step-note">Paste a <strong>' + esc(label) + '</strong> key and we will ask ' +
    'that provider what you can reach. It stays in this browser and goes nowhere else.</p>' +
    '<p class="key-hint">' + esc(PROVIDERS[provider].hint) + '</p>' +
    '<div class="key-form">' +
    '<input type="password" autocomplete="off" spellcheck="false" data-wiz-key placeholder="Paste key" />' +
    '<button type="button" class="btn btn-primary" data-wiz-connect>Connect</button></div>' +
    '<p class="key-status" data-wiz-status></p>';

  const input = host.querySelector('[data-wiz-key]');
  const btn = host.querySelector('[data-wiz-connect]');
  const status = host.querySelector('[data-wiz-status]');

  const connect = async () => {
    const key = input.value.trim();
    if (!key) {
      status.className = 'key-status bad';
      status.textContent = 'Paste a key first.';
      return;
    }
    btn.disabled = true;
    status.className = 'key-status';
    status.textContent = 'Checking with the provider…';
    try {
      await addKey(provider, key);
      input.value = ''; // do not leave it sitting in the DOM
      rebuildPickers();
      renderWizard(); // repaints into the connected state, nav included
    } catch (err) {
      btn.disabled = false;
      status.className = 'key-status bad';
      status.textContent = err.message;
    }
  };

  btn.onclick = connect;
  // Enter submits, same as every other step in the wizard.
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      connect();
    }
  };
  return false; // still offering to connect
}

/** Set a flow's tool value and keep its picker trigger in step. */
function setToolValue(flow, value) {
  $(flow + 'Tool').value = value;
  rebuildPickers();
}

function wizAdvance() {
  const steps = wizSteps();
  const step = steps[wizIndex];
  const optional = step.dataset.optional === 'true';
  // Direct child only: the tool picker has its own "something else" text input
  // nested inside it, which must not be mistaken for this step's value.
  const input = step.querySelector(':scope > input');

  if (input && !optional && !input.value.trim()) {
    showError(
      step.dataset.picker === 'true'
        ? 'Pick something to build with.'
        : "We'll need that one."
    );
    return;
  }
  showError('');

  if (wizIndex === steps.length - 1) FLOWS[wizFlow].send();
  else {
    wizIndex++;
    renderWizard();
  }
}

function wizRetreat() {
  if (wizIndex === 0) (wizFlow === 'solo' ? showPlay : showMultiplayer)();
  else {
    wizIndex--;
    renderWizard();
  }
}

$('sendPrompt').onclick = sendPrompt;
// Enter sends, shift+enter makes a new line - the shape people already expect.
$('promptInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendPrompt();
  }
});
document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    const showPreview = tab.dataset.tab === 'preview';
    $('tabPreview').hidden = !showPreview;
    $('tabCode').hidden = showPreview;
    if (showPreview) refreshSandboxPreview();
  };
});

$('menuPlay').onclick = showPlay;
$('menuWatch').onclick = showWatch;
$('refreshMatches').onclick = () => loadMatches(true);
$('practiceAgain').onclick = () => sendMsg({ type: 'reset' });
$('chooseSolo').onclick = () => startFlow('solo');
$('chooseMultiplayer').onclick = showMultiplayer;
$('chooseCreate').onclick = () => startFlow('create');
$('chooseJoin').onclick = () => startFlow('join');

document.querySelectorAll('[data-reroll]').forEach((btn) => {
  btn.onclick = () => {
    const input = btn.parentElement.querySelector('input[type="text"]');
    input.value = generateNickname();
    input.focus();
  };
});

$('wizNext').onclick = wizAdvance;
$('wizBack').onclick = wizRetreat;

// Enter moves to the next question rather than doing nothing.
document.querySelectorAll('.wiz-step input[type="text"]').forEach((input) => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      wizAdvance();
    }
  });
});

registerPicker('createToolPicker', 'createTool');
registerPicker('joinToolPicker', 'joinTool');
registerPicker('soloToolPicker', 'soloTool');

$('addBotBtn').onclick = () => sendMsg({ type: 'add_bot' });

$('refreshLobbies').onclick = loadLobbies;

/* ------------------------------------------------------- watch a match -- */
let matchPoll = null;
let lastMatchSignature = null;

function showWatch() {
  show('watch');
  showError('');
  loadMatches(true);
  clearInterval(matchPoll);
  matchPoll = setInterval(loadMatches, 4000);
  setPageBack('Menu', () => {
    clearInterval(matchPoll);
    matchPoll = null;
    show('entry');
    showChoice();
  });
}

async function loadMatches(force = false) {
  // Stop polling once we are actually watching something.
  if (state && state.spectating) return;
  let list = [];
  try {
    const res = await fetch('/api/lobbies');
    list = await res.json();
  } catch (_) {
    return; // server restarting; the next tick will pick it up
  }
  const live = list.filter((l) => l.watchable);
  const signature = JSON.stringify(live);
  if (!force && signature === lastMatchSignature) return;
  lastMatchSignature = signature;

  $('matchList').innerHTML =
    live
      .map((l) => {
        const left = l.endsAt ? Math.max(0, l.endsAt - l.serverNow) : 0;
        const mins = Math.floor(left / 60000);
        const secs = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
        const phase =
          l.phase === 'active'
            ? `<span class="live-dot"></span>Building, ${mins}:${secs} left`
            : l.phase === 'reveal'
              ? 'Voting now'
              : 'Finished';
        return (
          `<li><span class="chip chip-accent">${esc(l.id)}</span>` +
          `<span class="who">${esc(l.name)}</span>` +
          `<span class="meta">${phase}<span class="meta-sep">/</span>` +
          `${l.participants} building<span class="meta-sep">/</span>` +
          `${l.spectators} watching</span>` +
          `<button class="btn btn-primary" data-watch="${esc(l.id)}" style="margin-left:auto">Watch</button>` +
          (l.task ? `<span class="match-task" style="flex-basis:100%">${esc(l.task)}</span>` : '') +
          '</li>'
        );
      })
      .join('') ||
    '<li class="slot-empty">&#128064; Nothing live right now. Start a battle and it shows up here.</li>';

  $('matchList')
    .querySelectorAll('[data-watch]')
    .forEach((btn) => {
      btn.onclick = () => {
        clearInterval(matchPoll);
        matchPoll = null;
        sendMsg({ type: 'spectate', lobbyId: btn.dataset.watch });
      };
    });
}

async function loadLobbies() {
  let list = [];
  try {
    const res = await fetch('/api/lobbies');
    list = await res.json();
  } catch (_) {
    return; // server restarting; the next tick will pick it up
  }
  // Rebuilding on every poll would destroy the row you are about to click, so
  // only touch the DOM when something actually changed.
  const signature = JSON.stringify(list);
  if (signature === lastLobbyListSignature) return;
  lastLobbyListSignature = signature;

  $('lobbyList').innerHTML =
    list
      .map(
        (l) =>
          // One chip for the code, the rest as plain text: three pills per row
          // was too noisy when the list gets long.
          `<li><span class="chip chip-accent">${esc(l.id)}</span>` +
          `<span class="who">${esc(l.name)}</span>` +
          `<span class="meta">${l.participants}/${l.maxParticipants} in` +
          `<span class="meta-sep">/</span>${esc(l.phase)}</span>` +
          `<button class="btn" data-join-lobby="${esc(l.id)}" style="margin-left:auto"${
            l.joinable ? '' : ' disabled'
          }>${l.joinable ? 'Join' : l.phase === 'lobby' ? 'Full' : 'In progress'}</button></li>`
      )
      .join('') || '<li class="slot-empty">&#128273; No lobbies open. Create one.</li>';

  $('lobbyList')
    .querySelectorAll('[data-join-lobby]')
    .forEach((btn) => {
      btn.onclick = () => joinFromList(btn.dataset.joinLobby);
    });
}

/** Join from the open-lobbies list: fill the code in and skip that question. */
function joinFromList(lobbyId) {
  $('joinLobbyId').value = lobbyId;
  const name = $('joinName').value.trim();
  const tool = $('joinTool').value.trim();
  if (name && tool) {
    showError('');
    sendMsg({ type: 'join', lobbyId, name, tool });
    return;
  }
  startFlow('join', 1); // straight to "what should we call you?"
}

// Keep the open-lobbies list fresh while sitting on the entry screen.
setInterval(() => {
  if ($('entry').classList.contains('visible') && !$('multiplayerScreen').hidden) loadLobbies();
}, 3000);

const rollPrompt = () => sendMsg({ type: 'roll_prompt', topic: $('topicSelect').value });

$('rollBtn').onclick = rollPrompt;
// Changing the filter immediately rolls a matching brief.
$('topicSelect').onchange = rollPrompt;

$('minutesInput').onchange = () =>
  sendMsg({ type: 'set_minutes', minutes: Number($('minutesInput').value) });

$('startBtn').onclick = () =>
  sendMsg({ type: 'start', allowUnderMin: $('allowUnderMin').checked });

$('forceEndBtn').onclick = () => sendMsg({ type: 'force_end' });
$('forceResultsBtn').onclick = () => sendMsg({ type: 'force_results' });
$('resetBtn').onclick = () => {
  revealBuiltFor = null;
  sendMsg({ type: 'reset' });
};

$('submitBtn').onclick = () => sendMsg({ type: 'submit', code: $('codeInput').value });

$('prevContestant').onclick = () => {
  if (revealIndex > 0) {
    revealIndex--;
    showContestant(state.participants);
  }
};
$('nextContestant').onclick = () => {
  if (revealIndex < state.participants.length - 1) {
    revealIndex++;
    showContestant(state.participants);
  }
};

$('codeInput').addEventListener('input', () => {
  syncHighlight();
  if (!$('tabPreview').hidden) refreshSandboxPreview();
});
$('codeInput').addEventListener('scroll', () => {
  const layer = document.querySelector('.editor-highlight');
  layer.scrollTop = $('codeInput').scrollTop;
  layer.scrollLeft = $('codeInput').scrollLeft;
});

// Autosave the draft so the server can lock in work-in-progress at the buzzer.
// Event-driven rather than purely timed: browsers throttle timers to ~1/min in
// hidden tabs, and participants routinely tab away to their LLM mid-round.
let draftDebounce = null;

function flushDraft() {
  clearTimeout(draftDebounce);
  draftDebounce = null;
  const val = $('codeInput').value;
  if (state?.lobby.phase !== 'active') return;
  if (myParticipant()?.submitted) return;
  if (val === sentDraft) return;
  sentDraft = val;
  sendMsg({ type: 'draft', code: val });
}

$('codeInput').addEventListener('input', () => {
  clearTimeout(draftDebounce);
  draftDebounce = setTimeout(flushDraft, 400);
});
// Leaving the tab is exactly when timers stop being reliable, so flush first.
$('codeInput').addEventListener('blur', flushDraft);
window.addEventListener('blur', flushDraft);
window.addEventListener('pagehide', flushDraft);
document.addEventListener('visibilitychange', flushDraft);
setInterval(flushDraft, 2000); // slow backstop for anything the events missed

// ------------------------------------------------------------------- boot ---

ensureIdentity();
// The landing screen is what the markup already shows, but nothing has run
// show()/showChoice() yet to match the chrome to it.
syncNavChrome();
maybeOfferGuide();

connect(() => {
  const saved = sessionStorage.getItem('vibewars');
  if (saved) {
    const { lobbyId, token } = JSON.parse(saved);
    sendMsg({ type: 'resume', lobbyId, token });
  }
  loadLobbies();
});
