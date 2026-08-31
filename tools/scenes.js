/* The battle the screenshots are taken from.
 *
 * Every shot below is a real phase of a real round: the script plays through
 * create -> lobby -> build -> reveal -> vote -> results using the same
 * messages the UI sends, and clips the part of the screen the guide step is
 * about. Nothing here fakes a screen that the game cannot actually produce.
 *
 * The submitted HTML is written out in full rather than generated, because it
 * is what appears in the preview and in the reveal frames - it needs to look
 * like something a person would be pleased to have built in ten minutes. */

/** The brief every shot is taken against. Chosen, not random: the submission
 *  below is written to answer this exact task, and a guide whose screenshots
 *  argue with each other is worse than no screenshots. */
const TARGET_PRODUCT = 'PlantMind';

/** Ada's submission. One file, no build step, and it answers all four things
 *  the brief asks for - hero, features, pricing, call to action. */
const DEMO_HTML = `<!doctype html>
<meta charset="utf-8">
<title>PlantMind</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #eef3ec; font: 16px/1.55 ui-rounded, "Avenir Next", system-ui, sans-serif;
    background: radial-gradient(110% 90% at 50% 0%, #17301f 0%, #0e1712 55%, #0b0f0c 100%);
  }
  .wrap { max-width: 760px; margin: 0 auto; padding: 34px 26px 40px; }
  .top { display: flex; align-items: center; gap: 9px; font-weight: 700; letter-spacing: -.2px; }
  .dot { width: 22px; height: 22px; border-radius: 7px; background: #58d68d; display: grid; place-items: center; font-size: 13px; }
  h1 { font-size: 38px; line-height: 1.08; margin: 26px 0 10px; letter-spacing: -1px; }
  h1 em { font-style: normal; color: #7ee6a8; }
  .lede { color: #a9bfae; font-size: 16.5px; margin: 0 0 22px; max-width: 52ch; }
  .cta { display: inline-flex; gap: 10px; align-items: center; padding: 12px 22px; border-radius: 999px;
         background: #58d68d; color: #08120c; font-weight: 700; text-decoration: none; }
  .ghost { color: #a9bfae; text-decoration: none; font-size: 14.5px; margin-left: 14px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 34px 0 10px; }
  .f { background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.08); border-radius: 15px; padding: 15px; }
  .f b { display: block; margin-bottom: 5px; font-size: 14.5px; }
  .f span { color: #9db3a3; font-size: 13px; }
  .label { font-size: 11.5px; letter-spacing: .16em; text-transform: uppercase; color: #7f9686; margin: 32px 0 12px; }
  .plans { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .p { border: 1px solid rgba(255,255,255,.1); border-radius: 15px; padding: 16px; text-align: center; }
  .p.best { border-color: #58d68d; background: rgba(88,214,141,.09); }
  .p .n { font-size: 13px; color: #9db3a3; }
  .p .v { font-size: 26px; font-weight: 800; margin: 5px 0 2px; }
  .p .u { font-size: 12px; color: #7f9686; }
  .quote { margin-top: 30px; padding: 15px 18px; border-left: 3px solid #58d68d;
           background: rgba(255,255,255,.03); border-radius: 0 12px 12px 0; color: #c6d8cb; font-size: 14.5px; }
</style>
<div class="wrap">
  <div class="top"><span class="dot">&#127793;</span> PlantMind</div>

  <h1>Your monstera has <em>opinions</em>.<br>Finally, you can hear them.</h1>
  <p class="lede">PlantMind listens to soil, light and leaf posture, then translates all of it
     into plain, slightly passive-aggressive English.</p>
  <a class="cta" href="#get">Start listening &#8594;</a>
  <a class="ghost" href="#how">See how it works</a>

  <div class="grid">
    <div class="f"><b>&#128172; Live translation</b><span>Real sentences, not moisture graphs.</span></div>
    <div class="f"><b>&#128220; Mood history</b><span>Track the sulking over weeks.</span></div>
    <div class="f"><b>&#128276; Thirst alerts</b><span>It texts you before it wilts.</span></div>
  </div>

  <div class="label">Pricing</div>
  <div class="plans">
    <div class="p"><div class="n">Seedling</div><div class="v">Free</div><div class="u">1 plant</div></div>
    <div class="p best"><div class="n">Greenhouse</div><div class="v">$9</div><div class="u">per month</div></div>
    <div class="p"><div class="n">Jungle</div><div class="v">$24</div><div class="u">unlimited</div></div>
  </div>

  <p class="quote">"It told me it was fine. It was not fine." &#8212; Dani, fern owner</p>
</div>`;

/** Kai's answer to the same brief. Deliberately a different take - lighter,
 *  chat-led rather than marketing-led - so the reveal shows two people solving
 *  one brief differently, which is the entire point of the game. */
const RIVAL_HTML = `<!doctype html>
<meta charset="utf-8">
<title>PlantMind</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f6f1; color: #1d241c;
         font: 16px/1.5 ui-rounded, "Avenir Next", system-ui, sans-serif; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 34px 24px; }
  .badge { display: inline-block; padding: 5px 12px; border-radius: 999px;
           background: #dff0e2; color: #226c3c; font-size: 12.5px; font-weight: 700; }
  h1 { font-size: 34px; line-height: 1.12; margin: 16px 0 8px; letter-spacing: -.8px; }
  p.sub { color: #5c6b5e; margin: 0 0 24px; }
  .chat { background: #fff; border: 1px solid #e0e6dd; border-radius: 18px; padding: 16px; }
  .b { max-width: 82%; padding: 10px 14px; border-radius: 15px; margin-bottom: 9px; font-size: 14.5px; }
  .them { background: #eef3ec; border-bottom-left-radius: 5px; }
  .me { background: #2f9e5f; color: #fff; margin-left: auto; border-bottom-right-radius: 5px; }
  .row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 22px; }
  .c { background: #fff; border: 1px solid #e0e6dd; border-radius: 14px; padding: 13px; }
  .c b { display: block; font-size: 14px; margin-bottom: 3px; }
  .c span { color: #6b7a6d; font-size: 12.5px; }
  .price { margin-top: 22px; display: flex; align-items: center; justify-content: space-between;
           background: #1d241c; color: #fff; border-radius: 16px; padding: 15px 18px; }
  .price b { font-size: 21px; }
  .price a { background: #7ee6a8; color: #10281a; text-decoration: none; font-weight: 700;
             padding: 10px 18px; border-radius: 999px; font-size: 14px; }
</style>
<div class="wrap">
  <span class="badge">&#127793; PlantMind</span>
  <h1>Ask your plant<br>how it is doing.</h1>
  <p class="sub">A sensor, an app, and a translator for the sulking.</p>

  <div class="chat">
    <div class="b them">The light has moved. I have not.</div>
    <div class="b them">It has been nine days.</div>
    <div class="b me">Watering you now.</div>
    <div class="b them">Adequate.</div>
  </div>

  <div class="row">
    <div class="c"><b>Translate</b><span>Sensor data to sentences</span></div>
    <div class="c"><b>Remember</b><span>Every mood, logged</span></div>
    <div class="c"><b>Nudge</b><span>Before it is too late</span></div>
  </div>

  <div class="price"><span><b>$9</b> / month &#183; one plant free</span>
    <a href="#">Get PlantMind</a></div>
</div>`;

module.exports = async function scenes({ cdp, shoot, until, wait, PORT, openPlayer }) {
  const url = `http://localhost:${PORT}/`;

  /* ---------------------------------------------------------- arrival ---- */
  // Land on the origin first: about:blank has no storage to clear, and the
  // browser refuses the access rather than returning nothing.
  await cdp.send('Page.navigate', { url });
  await until(cdp, `document.readyState === 'complete'`, 'first load');
  await cdp.eval(`localStorage.clear(); sessionStorage.clear(); return 1;`);
  await cdp.send('Page.navigate', { url });
  await until(cdp, `document.getElementById('gateEnter')`, 'name gate');

  /* The navbar is position:fixed, so it sits on top of anything clipped from
   * further down the page. It is chrome, not part of any step being explained,
   * so it comes out for the duration. */
  await cdp.eval(`
    const css = document.createElement('style');
    css.id = 'shot-css';
    css.textContent =
      '.navbar, .sponsor-rail, #pageBack, .grain { display: none !important; }' +
      'body { padding-top: 0 !important; }' +
      // Caret and focus rings are artefacts of being driven, not of playing.
      '*:focus, *:focus-visible { outline: none !important; box-shadow: none !important; }' +
      'textarea, input { caret-color: transparent !important; }';
    document.head.appendChild(css);
    return 1;
  `);
  await wait(600);

  console.log('\ncapturing:');

  // 1. Picking a name. The first thing anyone actually does.
  await cdp.eval(`document.getElementById('gateName').value = 'Ada'; return 1;`);
  await shoot(cdp, '1-name', '.gate-card', { pad: 0 });

  await cdp.eval(`document.getElementById('gateEnter').click(); return 1;`);
  await until(cdp, `!needsName()`, 'past the gate');
  await wait(400);

  /* ------------------------------------------------------ pick a model --- */
  // The create wizard, parked on the question that matters most.
  await cdp.eval(`
    showPlay(); showMultiplayer(); startFlow('create');
    return 1;
  `);
  await wait(300);
  // Walk to the step that asks what you are building with.
  await cdp.eval(`
    for (let i = 0; i < 6; i++) {
      const label = (document.getElementById('wizTitle')?.textContent || '') +
                    (document.querySelector('.wiz-label')?.textContent || '');
      if (/tool|build|model/i.test(label)) break;
      const next = document.querySelector('[data-wiz="next"]');
      if (!next) break;
      next.click();
      await new Promise(r => setTimeout(r, 220));
    }
    return document.getElementById('wizTitle')?.textContent;
  `);
  /* Show the picker open. A collapsed select reading "Pick your weapon" says
   * nothing; the list is the point of the step - these are the models you can
   * declare, and the one you choose is stamped on your tile. */
  await cdp.eval(`
    const pick = document.querySelector('#createToolPicker .picker-model[data-value="Claude Opus 4.6"]')
              || document.querySelector('#createToolPicker .picker-model');
    if (pick) pick.click();
    await new Promise(r => setTimeout(r, 200));
    document.querySelector('#createToolPicker .picker-trigger').click();
    return document.getElementById('createTool').value;
  `);
  await wait(500);
  await shoot(cdp, '2-model', ['.wizard', '#createToolPicker .picker-panel'], { pad: 0 });

  /* ------------------------------------------------------------ lobby ---- */
  await cdp.eval(`
    sendMsg({ type: 'create', lobbyName: 'Friday night', name: 'Ada',
              tool: 'Claude Opus 5', verified: false, playerId: identity.playerId });
    return 1;
  `);
  await until(cdp, `state && state.lobby && state.lobby.phase === 'lobby'`, 'lobby');

  // Fill the room, then deal the brief.
  const code = await cdp.eval(`return state.lobby.id;`);

  // Two stand-ins plus a real second player, who joins next.
  await cdp.eval(`
    for (let i = 0; i < 2; i++) { sendMsg({ type: 'add_bot' }); await new Promise(r => setTimeout(r, 260)); }
    sendMsg({ type: 'set_minutes', minutes: 10 });
    return 1;
  `);

  const kai = await openPlayer();
  await kai.send('Page.navigate', { url });
  await until(kai, `document.getElementById('gateEnter')`, "Kai's gate");
  await kai.eval(`
    document.getElementById('gateName').value = 'Kai';
    document.getElementById('gateEnter').click();
    return 1;
  `);
  await until(kai, `!needsName()`, 'Kai past the gate');
  await kai.eval(`
    sendMsg({ type: 'join', lobbyId: ${JSON.stringify(code)}, name: 'Kai',
              tool: 'GPT-5.6', verified: false, playerId: identity.playerId });
    return 1;
  `);
  await until(cdp, `state.participants.some(p => p.name === 'Kai')`, 'Kai in the lobby');
  // Hand the foreground back to the page being photographed.
  await cdp.send('Page.bringToFront');
  await wait(500);
  await wait(700);

  /* Roll until the chosen brief comes up. The server deals at random and there
   * is no back door to set a prompt - adding one just for screenshots would
   * mean the shots came from a code path players never touch. */
  const dealt = await cdp.eval(`
    for (let i = 0; i < 200; i++) {
      sendMsg({ type: 'roll_prompt', topic: 'EASY' });
      await new Promise(r => setTimeout(r, 90));
      const p = state.lobby.prompt;
      if (p && p.productName === ${JSON.stringify('PlantMind')}) return p.task;
    }
    return null;
  `);
  if (!dealt) throw new Error('never rolled the target brief');
  console.log('  brief: ' + dealt);
  await wait(700);

  // 3. The brief everyone is handed.
  await shoot(cdp, '3-brief', '#promptCardLobby', { pad: 0 });

  /* ------------------------------------------------------------ build ---- */
  await cdp.eval(`sendMsg({ type: 'start', allowUnderMin: true }); return 1;`);
  await until(cdp, `state.lobby.phase === 'active'`, 'the round to start');
  await wait(500);

  // Put a real submission in the editor and let the preview render it.
  await cdp.eval(`
    const ta = document.getElementById('codeInput');
    ta.value = ${JSON.stringify(DEMO_HTML)};
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    refreshSandboxPreview();
    // A sandbox with an empty chat log looks unused, so show the exchange that
    // would have produced this file.
    const log = document.getElementById('chatLog');
    if (log) log.innerHTML =
      '<div class="msg msg-you"><div class="msg-body">Landing page for PlantMind - an AI that ' +
      'translates what houseplants are thinking. Dark and green, hero, three features, three ' +
      'pricing tiers. Funny, not cute.</div></div>' +
      '<div class="msg msg-ai"><div class="msg-body">Single file, no dependencies. Hero leads on ' +
      'the joke, features stay short, and the middle plan is the one highlighted.</div></div>' +
      '<div class="msg msg-you"><div class="msg-body">Make the headline bigger and add a ' +
      'testimonial at the bottom.</div></div>';
    return 1;
  `);
  await wait(1400);   // let the iframe paint

  // 4. The workspace: clock, brief, prompt on the left, live render on the right.
  await shoot(cdp, '4-build', '.workspace', { pad: 0, maxPx: 1800 });

  /* ----------------------------------------------------------- reveal ---- */
  // Kai builds their own answer to the same brief and ships it.
  await kai.eval(`
    const ta = document.getElementById('codeInput');
    ta.value = ${JSON.stringify(RIVAL_HTML)};
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    sendMsg({ type: 'submit', code: ta.value });
    return 1;
  `);
  await cdp.eval(`sendMsg({ type: 'submit', code: document.getElementById('codeInput').value }); return 1;`);

  /* Let the stand-ins hand in on their own clock. Forcing the end here is what
   * turned them into DNFs last time, and a guide whose judging screenshot is a
   * blank white frame teaches nobody anything. The round advances by itself
   * once everyone has submitted. */
  await until(cdp, `state.lobby.phase === 'reveal'`, 'everyone to submit', 60000);
  await wait(2000);

  /* Step to Kai's entry: a real second player who answered this brief. You
   * never vote on your own work, so Ada's own page is not in this rotation. */
  const judging = await cdp.eval(`
    for (let i = 0; i < 8; i++) {
      if (/Kai/.test(document.getElementById('voteNavName')?.textContent || '')) break;
      document.getElementById('nextContestant').click();
      await new Promise(r => setTimeout(r, 450));
    }
    return document.getElementById('voteNavName')?.textContent;
  `);
  console.log('  judging: ' + judging);
  await wait(1500);   // the reveal iframe reloads on every step

  // 5. One contestant's work, rendered live and labelled with who built it.
  //    Cropped above the ballot: that is the next step's job, not this one's.
  const tile = `#grid .tile[data-participant="${await cdp.eval(`
    const t = [...document.querySelectorAll('#grid .tile')]
      .find(el => /Kai/.test(el.querySelector('.tile-name')?.textContent || ''));
    return t ? t.dataset.participant : '';
  `)}"]`;
  await shoot(cdp, '5-judge', tile, { pad: 0, maxHeight: 760 });

  /* Fill the ballot in before shooting it. Five empty rows of stars show the
   * furniture but not the act - a part-marked card is what scoring actually
   * looks like, and it shows that the stars are what you click. */
  await cdp.eval(`
    const want = { requirements: 5, functionality: 4, aesthetic: 5, approach: 4 };
    const t = document.querySelector(${JSON.stringify(tile)});
    const rows = [...t.querySelectorAll('.criterion')];
    const vals = [5, 4, 5, 4];
    rows.forEach((row, i) => {
      const star = row.querySelector('input[value="' + vals[i] + '"]');
      if (star) star.checked = true;
    });
    return rows.length;
  `);
  await wait(400);

  // 6. The ballot: four criteria, five stars each, one card per contestant.
  await shoot(cdp, '6-vote', tile + ' .tile-foot', { pad: 0 });

  /* ---------------------------------------------------------- results ---- *
   * Both humans actually fill their ballots in, rather than the round being
   * force-closed with no votes cast. It is the real path through the game, and
   * it means the board at the end is a genuine result. */
  const castBallots = async (page, favour) => {
    await page.send('Page.bringToFront');
    return page.eval(`
      const tiles = [...document.querySelectorAll('#grid .tile')];
      let cast = 0;
      for (const t of tiles) {
        const name = t.querySelector('.tile-name')?.textContent || '';
        const rows = [...t.querySelectorAll('.criterion')];
        if (!rows.length) continue;
        const good = ${JSON.stringify(favour)};
        // A believable ballot: strong for the entry that answered the brief,
        // middling for the stand-ins' unrelated page.
        const scores = new RegExp(good).test(name) ? [5, 5, 5, 4] : [3, 3, 2, 3];
        rows.forEach((row, i) => {
          const star = row.querySelector('input[value="' + scores[i] + '"]');
          if (star) { star.checked = true; star.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        const btn = t.querySelector('.tile-foot button');
        if (btn && !btn.disabled) { btn.click(); cast++; await new Promise(r => setTimeout(r, 400)); }
      }
      return cast;
    `);
  };
  console.log('  ballots cast by Ada: ' + await castBallots(cdp, 'Kai'));
  console.log('  ballots cast by Kai: ' + await castBallots(kai, 'Ada'));

  await cdp.send('Page.bringToFront');
  await cdp.eval(`sendMsg({ type: 'force_results' }); return 1;`);
  await until(cdp, `state.lobby.phase === 'results'`, 'results');
  await wait(1400);

  /* The submissions gallery repeats what step five already showed, and it
   * shows the stand-ins' unrelated page next to it. The step is about the
   * board, so the gallery comes out of the crop. */
  await cdp.eval(`
    const grid = document.getElementById('resultsGrid');
    if (grid) grid.style.display = 'none';
    const titles = [...document.querySelectorAll('#results .section-title')];
    if (titles[1]) titles[1].style.display = 'none';
    const reset = document.getElementById('resetBtn');
    if (reset) reset.closest('div').style.display = 'none';
    document.querySelectorAll('.toast').forEach(t => t.remove());
    return 1;
  `);
  await wait(400);

  // 7. Someone gets crowned, and every score is on the table.
  await shoot(cdp, '7-results', '#results', { pad: 0 });
};
