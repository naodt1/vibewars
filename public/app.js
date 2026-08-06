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

/* Model catalogue for the tool picker. Edit this list as models ship; nothing
   else depends on the exact strings, they are just labels on a tile. */
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
  {
    name: 'Meta',
    models: ['Muse Spark 1.1', 'Llama 4 Scout', 'Llama 4 Maverick'],
  },
  {
    name: 'Open weights',
    models: ['DeepSeek V3', 'DeepSeek R1', 'Qwen3 Max', 'Mistral Large', 'Kimi K2', 'GLM-4.6'],
  },
  {
    name: 'Coding agents / IDEs',
    models: [
      'Claude Code',
      'Codex CLI',
      'Cursor',
      'GitHub Copilot',
      'Windsurf',
      'Cline',
      'Zed',
      'v0',
      'Lovable',
      'Bolt',
      'Replit Agent',
    ],
  },
];

/**
 * Expandable dropdown: providers collapse/expand to reveal their models, and the
 * chosen label is written into a hidden input so the rest of the app is unchanged.
 */
function setupToolPicker(mountId, hiddenInputId) {
  const mount = $(mountId);
  const hidden = $(hiddenInputId);

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

  for (const group of TOOL_GROUPS) {
    const wrap = document.createElement('div');
    wrap.className = 'picker-group';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'picker-group-head';
    head.setAttribute('aria-expanded', 'false');
    head.innerHTML = `<span>${esc(group.name)}</span><span class="picker-caret">▶</span>`;

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

  document.addEventListener('click', (e) => {
    if (!mount.contains(e.target)) closePanel();
  });

  mount.appendChild(trigger);
  mount.appendChild(panel);
}

let ws = null;
let state = null; // last snapshot from server
let me = null; // my participant id
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
      show('entry');
    }
    return;
  }
  if (msg.type === 'joined') {
    me = msg.participantId;
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
    $('navPhase').textContent = 'Not in a lobby';
    $('navPhase').className = 'chip chip-ink';
    $('navWho').textContent = 'Anon';
    $('leaveBtn').style.display = 'none';
    showError('');
    show('entry');
    loadLobbies();
    return;
  }
  if (msg.type === 'draft') {
    $('codeInput').value = msg.code || '';
    sentDraft = msg.code || '';
    syncHighlight();
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
}

function myParticipant() {
  return state?.participants.find((p) => p.id === me) || null;
}

function render() {
  const { lobby, participants } = state;
  const mine = myParticipant();
  const isHost = lobby.hostId === me;
  renderNav(lobby, mine);

  // Only animate when the phase actually turns over, not on every broadcast.
  const phaseChanged = lastRenderedPhase !== lobby.phase;
  lastRenderedPhase = lobby.phase;

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
  }

  if (phaseChanged) {
    animateIn(document.querySelector('section.visible'));
    document.querySelector('section.visible').scrollIntoView({ block: 'start' });
  }
}

// --- waiting room ---

function renderLobby(lobby, participants, isHost) {
  $('lobbyHeading').textContent = lobby.name;
  $('lobbyIdOut').textContent = lobby.id;
  $('lobbyCount').textContent = `${participants.length}/${lobby.maxParticipants}`;

  const filled = participants
    .map(
      (p) =>
        `<li><span class="who">${esc(p.name)}</span>` +
        `<span class="chip chip-muted">${esc(p.tool)}</span>` +
        (p.isBot ? '<span class="chip chip-ink">Fake player</span>' : '') +
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

/** Render the rolled brief into one of the coral prompt cards. */
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
    `<span class="chip chip-muted">Lvl ${p.level} - ${esc(p.levelName)}</span>` +
    `<span class="chip">${lobby.durationMinutes} min</span>` +
    '</div>' +
    '<span class="prompt-label">Context</span>' +
    `<p class="prompt-context">${esc(p.context)}</p>` +
    '<div class="prompt-task"><span class="prompt-label">Task</span>' +
    `<div class="prompt-task-text">${esc(p.task)}</div></div>` +
    `<p class="prompt-vibe"><strong>Vibe:</strong> ${esc(p.flavour)}</p>` +
    '<span class="prompt-label">Constraints</span>' +
    `<ul class="prompt-constraints">${p.constraints
      .map((c) => `<li>${esc(c)}</li>`)
      .join('')}</ul>`;
}

/** Fill the topic/difficulty dropdowns once, then keep them in sync. */
function syncPromptControls(lobby) {
  const topicSel = $('topicSelect');
  if (!topicSel.options.length) {
    topicSel.innerHTML =
      '<option value="RANDOM">Any topic</option>' +
      lobby.topics.map((t) => `<option value="${t}">${esc(t)}</option>`).join('');
    $('levelSelect').innerHTML =
      '<option value="RANDOM">Any difficulty</option>' +
      [1, 2, 3, 4]
        .map((l) => `<option value="${l}">Lvl ${l} - ${esc(lobby.levelNames[l])}</option>`)
        .join('');
  }
  if (document.activeElement !== topicSel) topicSel.value = lobby.topic || 'RANDOM';
  if (document.activeElement !== $('levelSelect')) {
    $('levelSelect').value = lobby.level ? String(lobby.level) : 'RANDOM';
  }
}

function renderNav(lobby, mine) {
  const phase = {
    lobby: 'In the lobby',
    active: 'Battle live',
    reveal: 'Voting',
    results: 'Results',
  }[lobby.phase];
  $('navPhase').textContent = phase;
  $('navPhase').className = 'chip ' + (lobby.phase === 'active' ? 'chip-accent' : 'chip-ink');
  $('navWho').textContent = mine ? `${mine.name} - ${mine.tool}` : 'Anon';
  $('leaveBtn').style.display = mine ? 'inline-flex' : 'none';
}

// --- build phase ---

function renderActive(lobby, mine, isHost) {
  renderPromptCard($('promptCardActive'), lobby);
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
    ? 'Locked. Waiting for the others.'
    : 'Submitting banks your remaining time (tiebreaker)';
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
    if (left <= 0) {
      clearInterval(countdownTimer);
      // Server lock is authoritative; block the UI immediately regardless.
      $('codeInput').readOnly = true;
      $('submitBtn').disabled = true;
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
      (p.dnf ? '<span class="chip chip-accent">DNF</span>' : '') +
      (p.autoSubmitted ? '<span class="chip chip-muted">Buzzer</span>' : '');
    tile.appendChild(head);

    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups');
    frame.srcdoc = p.code || '<!-- empty submission -->';
    tile.appendChild(frame);

    if (withVoting && !p.isYou) {
      tile.appendChild(buildVoteForm(p, lobby));
    } else if (withVoting) {
      const note = document.createElement('div');
      note.className = 'tile-foot muted';
      note.textContent = 'Your own submission. No self-voting.';
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
function renderWinner(lobby, rows) {
  const banner = $('winnerBanner');
  const winner = rows[0];
  if (!winner) {
    banner.innerHTML = '';
    return;
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

  // Once per round, and never for a round where nobody actually scored.
  const key = `${lobby.id}:${lobby.round}`;
  if (celebratedRound !== key && scored) {
    celebratedRound = key;
    fireConfetti();
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

/* ---------------------------------------------------------- info pages -- *
 * Rules, scoring and about live in a sheet rather than separate routes, so
 * reading them never disturbs a battle in progress. The hash keeps them
 * linkable, which matters once this is public. */

const PAGES = {
  how: { title: 'How it works', template: 'page-how' },
  scoring: { title: 'Scoring', template: 'page-scoring' },
  sponsor: { title: 'Sponsor vibewars', template: 'page-sponsor' },
  about: { title: 'About vibewars', template: 'page-about' },
};

function openPage(key) {
  const page = PAGES[key];
  if (!page) return;
  $('sheetTitle').textContent = page.title;
  $('sheetBody').innerHTML = '';
  $('sheetBody').appendChild($(page.template).content.cloneNode(true));
  $('sheet').hidden = false;
  $('sheet').querySelector('[data-close-sheet].btn').focus();
  if (location.hash !== '#' + key) history.pushState(null, '', '#' + key);
}

function closePage() {
  $('sheet').hidden = true;
  if (location.hash) history.pushState(null, '', location.pathname);
}

document.querySelectorAll('[data-page]').forEach((el) => {
  el.onclick = () => openPage(el.dataset.page);
});
document.querySelectorAll('[data-close-sheet]').forEach((el) => {
  el.onclick = closePage;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('sheet').hidden) closePage();
});
window.addEventListener('popstate', () => {
  const key = location.hash.slice(1);
  if (PAGES[key]) openPage(key);
  else $('sheet').hidden = true;
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
    submitLabel: 'Create lobby &#8599;',
    send: () =>
      sendMsg({
        type: 'create',
        lobbyName: $('createLobbyName').value,
        name: $('createName').value,
        tool: $('createTool').value,
      }),
  },
  join: {
    title: 'Join a battle',
    submitLabel: 'Join battle &#8599;',
    send: () =>
      sendMsg({
        type: 'join',
        lobbyId: $('joinLobbyId').value,
        name: $('joinName').value,
        tool: $('joinTool').value,
      }),
  },
};

let wizFlow = null;
let wizIndex = 0;

const wizSteps = () => [...document.querySelectorAll(`.wiz-step[data-flow="${wizFlow}"]`)];

function showChoice() {
  wizFlow = null;
  $('entryWizard').hidden = true;
  $('entryChoice').hidden = false;
  showError('');
}

function startFlow(flow, atIndex = 0) {
  wizFlow = flow;
  wizIndex = atIndex;
  $('entryChoice').hidden = true;
  $('entryWizard').hidden = false;
  showError('');
  renderWizard();
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

  const last = wizIndex === steps.length - 1;
  $('wizNext').innerHTML = last ? meta.submitLabel : 'Continue &#8594;';
  $('wizBack').textContent = wizIndex === 0 ? '← Back' : '← Back';

  // Focus the field so you can just keep typing and hitting enter.
  const input = step.querySelector('input[type="text"]');
  if (input) setTimeout(() => input.focus(), 0);
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
        ? 'Pick the model or tool you are using.'
        : 'This one is needed to carry on.'
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
  if (wizIndex === 0) showChoice();
  else {
    wizIndex--;
    renderWizard();
  }
}

$('chooseCreate').onclick = () => startFlow('create');
$('chooseJoin').onclick = () => startFlow('join');
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

setupToolPicker('createToolPicker', 'createTool');
setupToolPicker('joinToolPicker', 'joinTool');

$('addBotBtn').onclick = () => sendMsg({ type: 'add_bot' });

$('leaveBtn').onclick = () => {
  if (state && state.lobby.phase !== 'lobby' && !confirm('Leave this battle?')) return;
  sendMsg({ type: 'leave' });
};

$('refreshLobbies').onclick = loadLobbies;

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
      .join('') || '<li class="slot-empty">No lobbies yet</li>';

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
  if ($('entry').classList.contains('visible')) loadLobbies();
}, 3000);

const rollPrompt = () =>
  sendMsg({
    type: 'roll_prompt',
    topic: $('topicSelect').value,
    level: $('levelSelect').value === 'RANDOM' ? 'RANDOM' : Number($('levelSelect').value),
  });

$('rollBtn').onclick = rollPrompt;
// Changing either filter immediately rolls a matching brief.
$('topicSelect').onchange = rollPrompt;
$('levelSelect').onchange = rollPrompt;

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

$('codeInput').addEventListener('input', syncHighlight);
$('codeInput').addEventListener('scroll', () => {
  const layer = document.querySelector('.editor-highlight');
  layer.scrollTop = $('codeInput').scrollTop;
  layer.scrollLeft = $('codeInput').scrollLeft;
});

$('previewBtn').onclick = () => {
  const frame = $('selfPreview');
  frame.style.display = frame.style.display === 'none' ? 'block' : 'none';
  frame.srcdoc = $('codeInput').value;
};

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

connect(() => {
  const saved = sessionStorage.getItem('vibewars');
  if (saved) {
    const { lobbyId, token } = JSON.parse(saved);
    sendMsg({ type: 'resume', lobbyId, token });
  }
  loadLobbies();
});
