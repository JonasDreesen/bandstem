// Bandstem — stemmen op de nummers uit de gedeelde Spotify-playlist.

const INSTR = { zang: 'Zang', gitaar: 'Gitaar', bas: 'Bas', drums: 'Drums', piano: 'Piano', coach: 'Coach' };
const DIFF = { 1: 'Makkelijk', 2: 'Te doen', 3: 'Moeilijk' };
const VOTE = { super: '★ Super', yes: 'Ja', maybe: 'Misschien', no: 'Nee' };
const POINTS = { super: 3, yes: 2, maybe: 1, no: -2 };
const SUPER_MAX = 3;
const NEW_DAYS = 7;
const DOC_BUCKET = 'band-docs';
const DOC_MAX = 25 * 1024 * 1024;
const DOC_BLOCKED = /\.(html?|svg|js|mjs|exe|bat|cmd|sh|msi|apk)$/i;

const S = {
  sb: null, me: null, code: '',
  members: [], songs: [], votes: new Map(), status: null, playing: [], threads: [], drafts: new Map(), confirmRemove: null,
  docs: [], docUrls: new Map(), confirmDoc: null, uploading: new Set(),
  view: 'stemmen', filter: 'todo', sort: 'score', resFilter: 'all',
  open: new Set(), comments: new Set(), queues: new Map(), timers: new Map(),
};
const main = document.getElementById('main');

// ---------- Hulpjes ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
const key = (m, s) => m + '|' + s;
const mmss = ms => ms ? `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}` : '';
const isNew = s => (Date.now() - new Date(s.first_seen).getTime()) < NEW_DAYS * 864e5;
function ago(iso) {
  if (!iso) return 'nog nooit';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'net';
  if (min < 60) return `${min} min geleden`;
  const u = Math.round(min / 60);
  if (u < 24) return `${u} uur geleden`;
  return `${Math.round(u / 24)} dagen geleden`;
}
function errText(e) {
  const m = String(e?.message || e || '');
  if (/anonymous sign-ins are disabled/i.test(m)) return 'Anonieme login staat uit in Supabase. Zet "Allow anonymous sign-ins" aan (zie handleiding).';
  if (/verkeerde bandcode/.test(m)) return 'Die bandcode klopt niet.';
  if (/superlike-limiet/.test(m)) return `Je hebt al ${SUPER_MAX} superlikes gegeven. Haal er eerst één weg.`;
  if (/ongeldige naam/.test(m)) return 'Kies een naam van 1 tot 30 tekens.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Geen verbinding. Controleer je internet.';
  return m || 'Er ging iets mis.';
}
const myRow = songId => S.votes.get(key(S.me.id, songId)) || { vote: null, difficulty: null, comment: '' };
const mySupers = () => S.songs.filter(s => myRow(s.spotify_id).vote === 'super').length;
const isCoach = () => S.me?.instrument === 'coach';

// ---------- Opstarten ----------
async function boot() {
  let cfg;
  try { cfg = await (await fetch('config.json', { cache: 'no-store' })).json(); }
  catch { main.replaceChildren(h('p', { class: 'error', text: 'config.json kon niet geladen worden.' })); return; }
  if (!cfg.supabaseUrl || /JOUW-PROJECT/.test(cfg.supabaseUrl) || /PLAK/.test(cfg.supabasePublishableKey)) {
    main.replaceChildren(h('div', { class: 'notice bad' }, 'Bandstem is nog niet ingesteld: vul Supabase-gegevens in config.json in (zie README).'));
    return;
  }
  S.sb = supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const { data: { session } } = await S.sb.auth.getSession();
  if (session) {
    const me = await loadMe(session.user.id);
    if (me) { S.me = me; return startApp(); }
  }
  showLogin();
}

async function loadMe(uid) {
  const { data: dev } = await S.sb.from('band_devices').select('member_id').eq('uid', uid).maybeSingle();
  if (!dev) return null;
  const { data: m } = await S.sb.from('band_members').select('id,name,instrument').eq('id', dev.member_id).maybeSingle();
  return m || null;
}

// ---------- Inloggen ----------
function showLogin(step = 1, members = []) {
  document.getElementById('top').hidden = true;
  const err = h('p', { class: 'error', role: 'alert' });
  const box = h('section', { class: 'login' },
    h('span', { class: 'logo', style: 'align-self:flex-start' }, 'Bandstem'),
    h('h1', { text: step === 1 ? 'Welke nummers spelen we?' : 'Wie ben jij?' }),
  );
  if (step === 1) {
    box.append(h('p', { class: 'muted', text: 'Geef de bandcode in. Die krijg je van Jonas.' }));
    const inp = h('input', { class: 'input', id: 'code', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Bandcode' });
    const btn = h('button', { class: 'btn', type: 'submit', text: 'Verder' });
    box.append(h('form', { class: 'panel', onsubmit: async e => {
      e.preventDefault(); err.textContent = ''; btn.disabled = true;
      try {
        const { data, error } = await S.sb.rpc('band_check_code', { p_code: inp.value });
        if (error) throw error;
        if (!data?.ok) { err.textContent = 'Die bandcode klopt niet.'; return; }
        S.code = inp.value;
        showLogin(2, data.members || []);
      } catch (e2) { err.textContent = errText(e2); }
      finally { btn.disabled = false; }
    } }, h('div', { class: 'field' }, h('label', { class: 'label', for: 'code', text: 'Bandcode' }), inp), btn, err));
    main.replaceChildren(box); inp.focus();
    return;
  }

  async function join(name, instrument) {
    err.textContent = '';
    box.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const { data: { session } } = await S.sb.auth.getSession();
      if (!session) { const { error } = await S.sb.auth.signInAnonymously(); if (error) throw error; }
      const { data, error } = await S.sb.rpc('band_join', { p_code: S.code, p_name: name, p_instrument: instrument });
      if (error) throw error;
      S.me = data; S.code = '';
      startApp();
    } catch (e) {
      err.textContent = errText(e);
      box.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
  }

  if (members.length) {
    box.append(h('div', { class: 'field' }, h('span', { class: 'label', text: 'Ik ben' }),
      h('div', { class: 'who-list' }, members.map(m => h('button', { class: 'who-btn', type: 'button', onclick: () => join(m.name, null) },
        h('b', { text: m.name }), h('span', { class: 'muted', text: INSTR[m.instrument] || m.instrument }))))));
  }
  const name = h('input', { class: 'input', id: 'newname', type: 'text', maxlength: '30', autocomplete: 'given-name', placeholder: 'Voornaam' });
  const instr = h('select', { class: 'select', id: 'newinstr' }, Object.keys(INSTR).map(k => h('option', { value: k, text: INSTR[k] })));
  box.append(h('form', { class: 'panel', onsubmit: e => { e.preventDefault(); if (name.value.trim()) join(name.value, instr.value); else err.textContent = 'Vul je naam in.'; } },
    h('h2', { text: members.length ? 'Nieuw in de band?' : 'Jij bent de eerste' }),
    h('div', { class: 'row' },
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'newname', text: 'Naam' }), name),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'newinstr', text: 'Instrument' }), instr)),
    h('button', { class: 'btn', type: 'submit', text: 'Ik doe mee' })), err);
  main.replaceChildren(box);
}

// ---------- App ----------
async function startApp() {
  document.getElementById('top').hidden = false;
  S.view = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'stemmen';
  renderHeader();
  main.replaceChildren(h('p', { class: 'muted', text: 'Nummers laden…' }));
  await loadAll();
  render();
  S.sb.channel('band-votes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'band_votes' }, debounce(async () => { await loadVotes(); if (S.view === 'resultaten') render(); }, 500))
    .subscribe();
  const reloadPlaying = debounce(async () => { await loadPlaying(); if (S.view === 'spelen') renderPlaying(); else if (S.view === 'resultaten') render(); renderHeader(); }, 400);
  S.sb.channel('band-playing')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'band_playing' }, reloadPlaying)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'band_comments' }, reloadPlaying)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'band_documents' }, reloadPlaying)
    .subscribe();
  setInterval(refreshQuiet, 3 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshQuiet(); });
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

async function loadAll() {
  const [songs, members, , status] = await Promise.all([
    S.sb.from('band_songs').select('*').eq('removed', false).order('position', { ascending: true }),
    S.sb.from('band_members').select('id,name,instrument').order('created_at'),
    loadVotes(),
    S.sb.rpc('band_status'),
    loadPlaying(),
  ]);
  if (songs.error) toast(errText(songs.error));
  S.songs = songs.data || [];
  S.members = members.data || [];
  S.status = status.data || null;
  const mine = S.members.find(m => m.id === S.me.id); if (mine) S.me = mine;
  renderHeader();
}
async function loadVotes() {
  const { data, error } = await S.sb.from('band_votes').select('member_id,song_id,vote,difficulty,comment,updated_at');
  if (error) return;
  const pending = new Map([...S.votes].filter(([k]) => k.startsWith(S.me.id + '|') && (S.queues.get(k.split('|')[1]) || S.timers.has(k.split('|')[1]))));
  S.votes = new Map(data.map(r => [key(r.member_id, r.song_id), r]));
  for (const [k, v] of pending) S.votes.set(k, v); // eigen onopgeslagen wijzigingen niet overschrijven
}
async function loadPlaying() {
  const [pl, cm, dc] = await Promise.all([
    S.sb.from('band_playing').select('*').order('added_at'),
    S.sb.from('band_comments').select('id,song_id,member_id,body,created_at').order('created_at'),
    S.sb.from('band_documents').select('*').order('created_at'),
  ]);
  if (!pl.error) S.playing = pl.data || [];
  if (!cm.error) S.threads = cm.data || [];
  if (!dc.error) {
    S.docs = dc.data || [];
    const paths = S.docs.map(d => d.path).filter(p => !S.docUrls.has(p) || S.docUrls.get(p).until < Date.now() + 30 * 60000);
    if (paths.length) {
      const { data } = await S.sb.storage.from(DOC_BUCKET).createSignedUrls(paths, 6 * 3600);
      for (const r of data || []) if (r.signedUrl) S.docUrls.set(r.path, { url: r.signedUrl, until: Date.now() + 6 * 3600 * 1000 });
    }
  }
}
const isPlaying = id => S.playing.some(p => p.song_id === id);

async function refreshQuiet() {
  const before = S.songs.map(s => s.spotify_id).join();
  await loadAll();
  const changed = S.songs.map(s => s.spotify_id).join() !== before;
  const typing = document.activeElement?.matches('textarea');
  if (!typing && (S.view !== 'stemmen' || changed)) render();
}

// ---------- Kop ----------
function renderHeader() {
  const me = document.getElementById('me');
  const sel = h('select', { 'aria-label': 'Jouw instrument', id: 'myinstr', onchange: async e => {
    const v = e.target.value;
    const { error } = await S.sb.rpc('band_set_instrument', { p_instrument: v });
    if (error) return toast(errText(error));
    S.me.instrument = v; const m = S.members.find(x => x.id === S.me.id); if (m) m.instrument = v;
    toast(`Instrument gewijzigd naar ${INSTR[v]}`); render();
  } }, Object.keys(INSTR).map(k => h('option', { value: k, text: INSTR[k], selected: k === S.me.instrument })));
  me.replaceChildren(h('b', { text: S.me.name }), sel,
    h('button', { class: 'linkbtn', type: 'button', text: 'Afmelden', onclick: async () => { await S.sb.auth.signOut(); location.hash = ''; location.reload(); } }));

  const pl = document.getElementById('playlist');
  const st = S.status;
  if (!st || !st.connected) pl.replaceChildren(h('span', { class: 'warn', text: 'Nog niet gekoppeld met Spotify.' }));
  else pl.replaceChildren(
    h('span', {}, 'Playlist ', h('strong', { text: st.playlist_name || '' })),
    h('span', { text: `${S.songs.length} nummers` }),
    st.last_sync_error ? h('span', { class: 'warn', text: 'Bijwerken mislukt: ' + st.last_sync_error }) : h('span', { text: 'Bijgewerkt ' + ago(st.last_sync) }),
  );

  for (const v of Object.keys(VIEWS)) {
    const t = document.getElementById('tab-' + v);
    t.setAttribute('aria-selected', String(S.view === v));
    if (v === 'spelen') t.replaceChildren('We spelen', S.playing.length ? h('span', { class: 'count', text: String(S.playing.filter(p => S.songs.some(x => x.spotify_id === p.song_id)).length) }) : null);
    t.onclick = () => { S.view = v; history.replaceState(null, '', v === 'stemmen' ? '#' : '#' + v); renderHeader(); render(); window.scrollTo({ top: 0 }); };
  }
}

const VIEWS = { stemmen: () => renderVoting(), resultaten: () => renderResults(), spelen: () => renderPlaying() };
function render() { VIEWS[S.view](); }

// ---------- Stemmen ----------
function renderVoting() {
  const total = S.songs.length;
  if (!total) { main.replaceChildren(emptyState()); return; }
  const done = S.songs.filter(s => myRow(s.spotify_id).vote).length;
  const filters = [['todo', `Te beoordelen (${total - done})`], ['all', 'Alles'], ['new', 'Nieuw']];
  let list = S.songs;
  if (S.filter === 'todo') list = list.filter(s => !myRow(s.spotify_id).vote);
  if (S.filter === 'new') list = list.filter(isNew);

  main.replaceChildren(
    h('div', { class: 'progress' },
      h('div', { class: 'meta' }, h('span', { id: 'progtext', text: `Jij beoordeelde ${done} van ${total} nummers` }), h('span', { class: 'mono', id: 'progpct', text: Math.round(100 * done / total) + '%' })),
      h('div', { class: 'bar' }, h('span', { id: 'progbar', style: `width:${100 * done / total}%` })),
      h('div', { class: 'supers', id: 'supers' }, superMeter())),
    h('div', { class: 'toolbar' }, h('div', { class: 'chips' }, filters.map(([k, label]) =>
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(S.filter === k), text: label, onclick: () => { S.filter = k; renderVoting(); } })))),
    list.length
      ? h('div', { class: 'list' }, list.map(songCard))
      : h('div', { class: 'empty', text: S.filter === 'todo' ? 'Alles beoordeeld. Bekijk de resultaten, of kies "Alles" om iets aan te passen.' : 'Geen nummers in deze selectie.' }),
  );
}

function updateProgress() {
  const total = S.songs.length, done = S.songs.filter(s => myRow(s.spotify_id).vote).length;
  const t = document.getElementById('progtext'); if (!t) return;
  t.textContent = `Jij beoordeelde ${done} van ${total} nummers`;
  document.getElementById('progpct').textContent = Math.round(100 * done / total) + '%';
  document.getElementById('progbar').style.width = (100 * done / total) + '%';
  const chip = document.querySelector('.chips .chip'); if (chip) chip.textContent = `Te beoordelen (${total - done})`;
  document.getElementById('supers')?.replaceChildren(...superMeter());
}

function superMeter() {
  const used = mySupers();
  return [h('span', { class: 'stars', 'aria-hidden': 'true' }, Array.from({ length: SUPER_MAX }, (_, i) => h('span', { class: i < used ? 'on' : '', text: '★' }))),
    h('span', { text: used >= SUPER_MAX ? `Al je ${SUPER_MAX} superlikes zijn op` : `Nog ${SUPER_MAX - used} van ${SUPER_MAX} superlikes over, voor nummers waar je echt fan van bent` })];
}

function songHead(s) {
  return h('div', { class: 'song' },
    s.image_url ? h('img', { class: 'cover', src: s.image_url, alt: '', loading: 'lazy', width: '56', height: '56' }) : h('div', { class: 'cover' }),
    h('div', { style: 'min-width:0' },
      h('div', { class: 't', text: s.title }),
      h('div', { class: 'a' }, h('span', { text: s.artists }), s.duration_ms ? h('span', { class: 'mono', text: mmss(s.duration_ms) }) : null, isNew(s) ? h('span', { class: 'tag', text: 'nieuw' }) : null)));
}

function songCard(s) {
  const id = s.spotify_id, r = myRow(id);
  const card = h('article', { class: 'card' + (r.vote === 'super' ? ' super' : r.vote ? ' done' : ''), 'data-song': id });
  const voteSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Jouw stem' },
    Object.entries(VOTE).map(([v, label]) => h('button', { type: 'button', 'data-v': v, 'aria-pressed': String(r.vote === v), text: label,
      onclick: () => {
        if (v === 'super' && r.vote !== 'super' && mySupers() >= SUPER_MAX) return toast(`Je hebt al ${SUPER_MAX} superlikes gegeven. Haal er eerst één weg.`);
        save(id, { vote: r.vote === v ? null : v });
      } })));
  const diffSeg = isCoach() ? null : h('div', { class: 'difrow' },
    h('span', { class: 'label', text: INSTR[S.me.instrument] }),
    h('div', { class: 'seg small', role: 'group', 'aria-label': 'Moeilijkheid voor jouw instrument' },
      Object.entries(DIFF).map(([d, label]) => h('button', { type: 'button', 'data-d': d, 'aria-pressed': String(r.difficulty === Number(d)), text: label,
        onclick: () => save(id, { difficulty: r.difficulty === Number(d) ? null : Number(d) }) }))));

  const showComment = S.comments.has(id) || !!r.comment;
  const ta = h('textarea', { id: 'c-' + id, maxlength: '500', 'aria-label': isCoach() ? 'Advies' : 'Opmerking',
    placeholder: isCoach() ? 'Bv. goed nummer om samenspel te oefenen, let op het tempo in het refrein…' : 'Bv. te hoog voor mij, makkelijk riffje, goed als opener…' });
  ta.value = r.comment || '';
  const savedNote = h('span', { class: 'saved', 'aria-live': 'polite' });
  ta.addEventListener('input', () => {
    savedNote.textContent = '';
    S.votes.set(key(S.me.id, id), { ...myRow(id), member_id: S.me.id, song_id: id, comment: ta.value });
    clearTimeout(S.timers.get(id));
    S.timers.set(id, setTimeout(async () => { S.timers.delete(id); await save(id, { comment: ta.value.trim() }, false); savedNote.textContent = 'Opgeslagen'; }, 900));
  });

  const player = h('div', { class: 'player' });
  if (S.open.has(id)) player.append(embed(id));
  const actions = h('div', { class: 'actions' },
    h('button', { type: 'button', text: S.open.has(id) ? 'Speler sluiten' : '▶ Luisteren', onclick: () => { S.open.has(id) ? S.open.delete(id) : S.open.add(id); card.replaceWith(songCard(s)); } }),
    showComment ? null : h('button', { type: 'button', text: isCoach() ? 'Advies geven' : 'Opmerking', onclick: () => { S.comments.add(id); card.replaceWith(songCard(s)); document.getElementById('c-' + id)?.focus(); } }),
    h('a', { href: 'https://open.spotify.com/track/' + id, target: '_blank', rel: 'noopener', text: 'Open in Spotify' }));

  card.append(...[songHead(s), voteSeg, diffSeg, showComment ? h('div', { class: 'field' }, h('label', { class: 'label', for: 'c-' + id, text: isCoach() ? 'Advies als coach' : 'Opmerking' }), ta, savedNote) : null, actions, player].filter(Boolean));
  return card;
}
function embed(id) {
  return h('iframe', { src: `https://open.spotify.com/embed/track/${id}?utm_source=generator`, title: 'Spotify-speler', loading: 'lazy',
    allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture' });
}

// Eén schrijfactie tegelijk per nummer; de laatste stand wint.
function save(songId, patch, rerender = true) {
  const k = key(S.me.id, songId);
  const row = { ...myRow(songId), ...patch, member_id: S.me.id, song_id: songId };
  S.votes.set(k, row);
  if (rerender) {
    const card = main.querySelector(`[data-song="${songId}"]`);
    const s = S.songs.find(x => x.spotify_id === songId);
    if (card && s) card.replaceWith(songCard(s));
    updateProgress();
  }
  const prev = S.queues.get(songId) || Promise.resolve();
  const next = prev.then(async () => {
    const cur = S.votes.get(k);
    const { error } = await S.sb.from('band_votes').upsert({
      member_id: S.me.id, song_id: songId, vote: cur.vote || null, difficulty: cur.difficulty || null,
      comment: cur.comment ? cur.comment : null, updated_at: new Date().toISOString(),
    }, { onConflict: 'member_id,song_id' });
    if (error) {
      toast(/superlike-limiet/.test(error.message) ? errText(error) : 'Opslaan mislukt: ' + errText(error));
      await loadVotes();
      const card = main.querySelector(`[data-song="${songId}"]`), s = S.songs.find(x => x.spotify_id === songId);
      if (card && s && S.view === 'stemmen') card.replaceWith(songCard(s));
      updateProgress();
    }
  });
  S.queues.set(songId, next);
  next.finally(() => { if (S.queues.get(songId) === next) S.queues.delete(songId); });
  return next;
}

// ---------- Resultaten ----------
function tally(songId) {
  const t = { super: [], yes: [], maybe: [], no: [], none: [], diffs: [], comments: [], score: 0, diffAvg: null };
  for (const m of S.members) {
    const r = S.votes.get(key(m.id, songId));
    if (r?.vote) { t[r.vote].push(m); t.score += POINTS[r.vote]; } else t.none.push(m);
    if (r?.difficulty && m.instrument !== 'coach') t.diffs.push({ m, d: r.difficulty });
    if (r?.comment) t.comments.push({ m, c: r.comment });
  }
  t.comments.sort((a, b) => (b.m.instrument === 'coach') - (a.m.instrument === 'coach'));
  t.fans = t.super.length + t.yes.length;
  if (t.diffs.length) t.diffAvg = t.diffs.reduce((a, x) => a + x.d, 0) / t.diffs.length;
  return t;
}

function renderResults() {
  if (!S.songs.length) { main.replaceChildren(emptyState()); return; }
  const total = S.songs.length;
  const people = h('div', { class: 'people' }, S.members.map(m => {
    const n = S.songs.filter(s => S.votes.get(key(m.id, s.spotify_id))?.vote).length;
    return h('span', { class: 'person' + (n === total ? ' full' : '') }, h('b', { text: m.name }), h('span', { class: 'muted', text: INSTR[m.instrument] }), h('span', { class: 'mono', text: `${n}/${total}` }));
  }));

  let rows = S.songs.map(s => ({ s, t: tally(s.spotify_id) }));
  if (S.resFilter === 'noNo') rows = rows.filter(r => r.t.no.length === 0 && r.t.fans > 0);
  if (S.resFilter === 'complete') rows = rows.filter(r => r.t.none.length === 0);
  const sorters = {
    score: (a, b) => b.t.score - a.t.score || b.t.super.length - a.t.super.length || b.t.yes.length - a.t.yes.length || a.s.position - b.s.position,
    super: (a, b) => b.t.super.length - a.t.super.length || b.t.score - a.t.score,
    split: (a, b) => Math.min(b.t.fans, b.t.no.length) - Math.min(a.t.fans, a.t.no.length) || b.t.score - a.t.score,
    easy: (a, b) => (a.t.diffAvg ?? 9) - (b.t.diffAvg ?? 9) || b.t.score - a.t.score,
    new: (a, b) => new Date(b.s.first_seen) - new Date(a.s.first_seen) || a.s.position - b.s.position,
  };
  rows.sort(sorters[S.sort]);

  const sortSel = h('select', { class: 'select', id: 'sort', style: 'width:auto', 'aria-label': 'Sorteren', onchange: e => { S.sort = e.target.value; renderResults(); } },
    [['score', 'Hoogste score'], ['super', 'Meeste superlikes'], ['easy', 'Makkelijkst eerst'], ['split', 'Meest verdeeld'], ['new', 'Nieuwste eerst']]
      .map(([v, l]) => h('option', { value: v, text: l, selected: S.sort === v })));
  const chips = h('div', { class: 'chips' }, [['all', 'Alles'], ['noNo', 'Zonder Nee'], ['complete', 'Iedereen gestemd']].map(([k, l]) =>
    h('button', { class: 'chip', type: 'button', 'aria-pressed': String(S.resFilter === k), text: l, onclick: () => { S.resFilter = k; renderResults(); } })));

  const n = Math.max(1, S.members.length);
  const list = h('div', { class: 'list' }, rows.map((r, i) => {
    const { s, t } = r;
    const line = (cls, label, arr) => arr.length ? h('div', {}, h('span', { class: 'k ' + cls, text: `${label} ${arr.length}` }), arr.map(m => m.name).join(', ')) : null;
    const on = isPlaying(s.spotify_id);
    return h('article', { class: 'card' + (t.super.length ? ' super' : '') },
      h('div', { class: 'rank' },
        h('span', { class: 'n', text: String(i + 1) }),
        s.image_url ? h('img', { class: 'cover', src: s.image_url, alt: '', loading: 'lazy', width: '56', height: '56' }) : h('div', { class: 'cover' }),
        h('div', { style: 'min-width:0' }, h('div', { class: 't', style: 'font-weight:700;overflow-wrap:anywhere', text: s.title }), h('div', { class: 'muted', style: 'font-size:14px', text: s.artists })),
        h('span', { class: 'score' + (t.score > 0 ? ' pos' : t.score < 0 ? ' neg' : ''), title: 'Score', text: (t.score > 0 ? '+' : '') + t.score })),
      h('div', { class: 'stack', 'aria-hidden': 'true' },
        h('span', { class: 's', style: `width:${100 * t.super.length / n}%` }), h('span', { class: 'y', style: `width:${100 * t.yes.length / n}%` }), h('span', { class: 'm', style: `width:${100 * t.maybe.length / n}%` }), h('span', { class: 'x', style: `width:${100 * t.no.length / n}%` })),
      h('div', { class: 'lines' }, line('s', '★ Super', t.super), line('y', 'Ja', t.yes), line('m', 'Misschien', t.maybe), line('x', 'Nee', t.no), line('o', 'Nog niet', t.none)),
      t.diffs.length ? h('div', { class: 'diffs' }, t.diffs.map(({ m, d }) => h('span', { class: 'diff d' + d, text: `${INSTR[m.instrument]} (${m.name}): ${DIFF[d].toLowerCase()}` }))) : null,
      t.comments.length ? h('div', { class: 'comments' }, t.comments.map(({ m, c }) => h('div', { class: m.instrument === 'coach' ? 'coachnote' : null },
        m.instrument === 'coach' ? h('span', { class: 'badge', text: 'Coach' }) : null, h('b', { text: m.name + ': ' }), c))) : null,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: on ? 'playing-on' : null, 'aria-pressed': String(on), text: on ? '✓ We spelen dit' : '＋ We spelen dit',
          onclick: e => togglePlaying(s.spotify_id, e.currentTarget) }),
        h('a', { href: 'https://open.spotify.com/track/' + s.spotify_id, target: '_blank', rel: 'noopener', text: 'Open in Spotify' })));
  }));

  main.replaceChildren(
    h('div', { class: 'field' }, h('span', { class: 'label', text: 'Wie heeft al gestemd' }), people),
    h('div', { class: 'toolbar' }, chips, sortSel),
    h('p', { class: 'legend', text: `Score: ★ Super +3, Ja +2, Misschien +1, Nee −2. Iedereen heeft ${SUPER_MAX} superlikes. Moeilijkheid geeft elk bandlid voor zijn eigen instrument; de coach geeft advies.` }),
    rows.length ? list : h('div', { class: 'empty', text: 'Geen nummers in deze selectie.' }),
  );
}

// ---------- We spelen ----------
async function togglePlaying(songId, btn) {
  if (btn) btn.disabled = true;
  const on = isPlaying(songId);
  const { error } = on
    ? await S.sb.from('band_playing').delete().eq('song_id', songId)
    : await S.sb.from('band_playing').insert({ song_id: songId, added_by: S.me.id });
  if (error && !/duplicate key/i.test(error.message)) toast('Mislukt: ' + errText(error));
  else toast(on ? 'Van de lijst "We spelen" gehaald' : 'Op de lijst "We spelen" gezet');
  S.confirmRemove = null;
  await loadPlaying();
  renderHeader(); render();
}

function fmtDate(iso) {
  const d = new Date(iso), today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return 'vandaag ' + time;
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'gisteren ' + time;
  return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }) + ' ' + time;
}

// ---------- Toonaard ----------
async function saveKey(songId, patch) {
  const { error } = await S.sb.from('band_playing')
    .update({ ...patch, key_by: S.me.id, key_at: new Date().toISOString() }).eq('song_id', songId);
  if (error) return toast('Toonaard opslaan mislukt: ' + errText(error));
  if ('key_original' in patch) S.drafts.delete('ko-' + songId);
  if ('key_played' in patch) S.drafts.delete('kp-' + songId);
  await loadPlaying(); renderPlaying();
}
function keyBlock(p, names) {
  const id = p.song_id;
  const by = names[p.key_by];
  const field = (prefix, col, label, ph) => {
    const inp = h('input', { class: 'input', id: prefix + id, type: 'text', maxlength: '20', placeholder: ph, autocomplete: 'off' });
    inp.value = S.drafts.has(prefix + id) ? S.drafts.get(prefix + id) : (p[col] || '');
    inp.addEventListener('input', () => S.drafts.set(prefix + id, inp.value));
    inp.addEventListener('change', () => saveKey(id, { [col]: inp.value.trim() || null }));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    return h('div', { class: 'field' }, h('label', { class: 'label', for: prefix + id, text: label }), inp);
  };
  return h('div', { class: 'keyblock' },
    h('div', { class: 'difrow' },
      h('span', { class: 'label', text: 'Toonaard' }),
      h('div', { class: 'seg small', role: 'group', 'aria-label': 'Toonaard' },
        h('button', { type: 'button', 'data-d': 'o', 'aria-pressed': String(p.key_changed === false), text: 'Origineel',
          onclick: () => saveKey(id, { key_changed: p.key_changed === false ? null : false }) }),
        h('button', { type: 'button', 'data-d': 'a', 'aria-pressed': String(p.key_changed === true), text: 'Andere toonaard',
          onclick: () => saveKey(id, { key_changed: p.key_changed === true ? null : true }) }))),
    p.key_changed === true ? h('div', { class: 'row keyfields' },
      field('ko-', 'key_original', 'Origineel', 'bv. E'),
      field('kp-', 'key_played', 'Wij spelen in', 'bv. D of capo 2')) : null,
    p.key_changed != null && by ? h('span', { class: 'saved', text: `Aangepast door ${by.name}, ${fmtDate(p.key_at)}` }) : null);
}
function keySummary(p) {
  if (p.key_changed === false) return 'Originele toonaard';
  if (p.key_changed === true) {
    if (p.key_original && p.key_played) return `${p.key_original} → ${p.key_played}`;
    if (p.key_played) return `Gespeeld in ${p.key_played}`;
    return 'Andere toonaard';
  }
  return null;
}

// ---------- Documenten ----------
const fmtSize = b => b == null ? '' : b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' kB' : (b / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
function docKind(d) {
  const ext = (d.name.match(/\.([a-z0-9]{1,5})$/i) || [, ''])[1].toUpperCase();
  if (/^image\//.test(d.mime || '')) return { kind: 'img', label: ext || 'FOTO' };
  if (/pdf/.test(d.mime || '') || ext === 'PDF') return { kind: 'pdf', label: 'PDF' };
  if (/^audio\//.test(d.mime || '')) return { kind: 'audio', label: '♪ ' + (ext || 'AUDIO') };
  return { kind: 'file', label: ext || 'BESTAND' };
}
async function uploadDocs(songId, files) {
  const list = [...files];
  const bad = list.filter(f => f.size > DOC_MAX || DOC_BLOCKED.test(f.name));
  for (const f of bad) toast(f.size > DOC_MAX ? `"${f.name}" is groter dan 25 MB.` : `"${f.name}" kan niet geüpload worden (bestandstype niet toegelaten).`);
  const ok = list.filter(f => !bad.includes(f));
  if (!ok.length) return;
  const slot = songId || 'algemeen';
  S.uploading.add(slot); renderPlaying();
  let done = 0;
  for (const f of ok) {
    const safe = f.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'bestand';
    const path = `${slot}/${crypto.randomUUID()}-${safe}`;
    const up = await S.sb.storage.from(DOC_BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
    if (up.error) { toast(`Uploaden van "${f.name}" mislukt: ${errText(up.error)}`); continue; }
    const ins = await S.sb.from('band_documents').insert({ song_id: songId, member_id: S.me.id, name: f.name.slice(0, 200), path, size_bytes: f.size, mime: f.type || null });
    if (ins.error) { await S.sb.storage.from(DOC_BUCKET).remove([path]); toast(`"${f.name}" opslaan mislukt: ${errText(ins.error)}`); continue; }
    done++;
  }
  S.uploading.delete(slot);
  if (done) toast(done === 1 ? 'Document toegevoegd' : `${done} documenten toegevoegd`);
  await loadPlaying(); renderPlaying();
}
async function deleteDoc(d) {
  const rm = await S.sb.storage.from(DOC_BUCKET).remove([d.path]);
  if (rm.error) return toast('Wissen mislukt: ' + errText(rm.error));
  const del = await S.sb.from('band_documents').delete().eq('id', d.id);
  if (del.error) return toast('Wissen mislukt: ' + errText(del.error));
  S.confirmDoc = null; S.docUrls.delete(d.path);
  await loadPlaying(); renderPlaying();
}
function docsBlock(songId, names) {
  const slot = songId || 'algemeen';
  const docs = S.docs.filter(d => (d.song_id || null) === (songId || null));
  const input = h('input', { type: 'file', multiple: true, class: 'visually-hidden', id: 'f-' + slot,
    accept: 'application/pdf,image/*,audio/*,.txt,.doc,.docx,.gp,.gpx,.gp5,.gp7,.musicxml,.mxl,.mscz,.mid,.midi',
    onchange: e => { const fl = e.target.files; if (fl?.length) uploadDocs(songId, fl); e.target.value = ''; } });
  const busy = S.uploading.has(slot);
  return h('div', { class: 'docs' },
    docs.map(d => {
      const k = docKind(d), url = S.docUrls.get(d.path)?.url, m = names[d.member_id], mine = d.member_id === S.me.id;
      const confirming = S.confirmDoc === d.id;
      return h('div', { class: 'doc' },
        k.kind === 'img' && url ? h('img', { class: 'doc-thumb', src: url, alt: '', loading: 'lazy', onerror: e => e.currentTarget.replaceWith(h('span', { class: 'doc-icon doc-file', text: k.label.slice(0, 5) })) }) : h('span', { class: 'doc-icon doc-' + k.kind, text: k.label.slice(0, 5) }),
        h('div', { class: 'doc-main' },
          url ? h('a', { href: url, target: '_blank', rel: 'noopener', class: 'doc-name', text: d.name }) : h('span', { class: 'doc-name', text: d.name }),
          h('span', { class: 'doc-meta', text: [fmtSize(d.size_bytes), m?.name || 'Oud bandlid', fmtDate(d.created_at)].filter(Boolean).join(' · ') })),
        mine ? (confirming
          ? h('span', { class: 'confirm' }, h('button', { class: 'linkbtn danger', type: 'button', text: 'Ja, wissen', onclick: () => deleteDoc(d) }),
              h('button', { class: 'linkbtn', type: 'button', text: 'Nee', onclick: () => { S.confirmDoc = null; renderPlaying(); } }))
          : h('button', { class: 'linkbtn', type: 'button', text: 'Wissen', 'aria-label': 'Document ' + d.name + ' wissen', onclick: () => { S.confirmDoc = d.id; renderPlaying(); } })) : null);
    }),
    h('label', { class: 'upload' + (busy ? ' busy' : ''), for: 'f-' + slot }, busy ? 'Bezig met uploaden…' : '＋ Document toevoegen', input),
    !docs.length && !songId ? h('span', { class: 'saved', text: 'Bv. de setlist, afspraken of een repetitieschema.' }) : null);
}

function renderPlaying() {
  const focusedId = document.activeElement?.id;
  const names = Object.fromEntries(S.members.map(m => [m.id, m]));
  const items = S.playing.map(p => ({ p, s: S.songs.find(x => x.spotify_id === p.song_id) })).filter(x => x.s);
  const general = h('section', { class: 'card general' },
    h('h2', { text: 'Banddocumenten' }),
    h('p', { class: 'muted', style: 'margin:0;font-size:14px', text: 'Voor iedereen zichtbaar. Documenten bij een specifiek nummer, zoals een partituur, voeg je toe bij dat nummer hieronder.' }),
    docsBlock(null, names));
  if (!items.length) {
    main.replaceChildren(general, h('div', { class: 'empty' },
      h('p', { style: 'margin:0 0 6px;font-weight:600;color:var(--ink)', text: 'Nog niets op de lijst' }),
      'Ga naar Resultaten en tik bij een nummer op "＋ We spelen dit". Hier verschijnen dan de nummers die jullie aan het instuderen zijn, met ruimte voor commentaar.'));
    return;
  }
  main.replaceChildren(
    general,
    h('p', { class: 'legend', text: `${items.length} ${items.length === 1 ? 'nummer' : 'nummers'} in het repertoire. Noteer hier wat beter moet, afspraken over de structuur of wat je volgende repetitie wil proberen.` }),
    h('div', { class: 'list' }, items.map(({ p, s }) => {
      const id = s.spotify_id;
      const thread = S.threads.filter(c => c.song_id === id);
      const t = tally(id);
      const ta = h('textarea', { id: 'n-' + id, maxlength: '1000', rows: '2', placeholder: 'Schrijf een opmerking…', 'aria-label': 'Nieuwe opmerking bij ' + s.title });
      ta.value = S.drafts.get(id) || '';
      ta.addEventListener('input', () => S.drafts.set(id, ta.value));
      const post = h('button', { class: 'btn', type: 'submit', text: 'Plaatsen' });
      const form = h('form', { class: 'composer', onsubmit: async e => {
        e.preventDefault();
        const body = ta.value.trim(); if (!body) return;
        post.disabled = true;
        const { error } = await S.sb.from('band_comments').insert({ song_id: id, member_id: S.me.id, body });
        post.disabled = false;
        if (error) return toast('Plaatsen mislukt: ' + errText(error));
        S.drafts.delete(id);
        await loadPlaying(); renderPlaying();
      } }, ta, post);
      const confirming = S.confirmRemove === id;
      const added = names[p.added_by];
      const player = h('div', { class: 'player' });
      if (S.open.has('p-' + id)) player.append(embed(id));
      return h('article', { class: 'card', 'data-playing': id },
        songHead(s),
        h('div', { class: 'meta-line' },
          h('span', { text: `Op de lijst sinds ${fmtDate(p.added_at).replace(/ \d\d:\d\d$/, '')}${added ? ' door ' + added.name : ''}` }),
          keySummary(p) ? h('span', { class: 'keychip', text: '♯ ' + keySummary(p) }) : null,
          h('span', { class: 'mono', text: (t.score > 0 ? '+' : '') + t.score + ' punten' })),
        keyBlock(p, names),
        h('div', { class: 'sub' }, h('span', { class: 'label', text: 'Documenten' }), docsBlock(id, names)),
        h('div', { class: 'thread' }, thread.length ? thread.map(c => {
          const m = names[c.member_id];
          const mine = c.member_id === S.me.id;
          return h('div', { class: 'msg' + (m?.instrument === 'coach' ? ' coachnote' : '') },
            h('div', { class: 'msg-head' },
              m?.instrument === 'coach' ? h('span', { class: 'badge', text: 'Coach' }) : null,
              h('b', { text: m?.name || 'Oud bandlid' }), h('span', { class: 'muted', text: fmtDate(c.created_at) }),
              mine ? h('button', { class: 'linkbtn', type: 'button', text: 'Wissen', 'aria-label': 'Eigen opmerking wissen', onclick: async () => {
                const { error } = await S.sb.from('band_comments').delete().eq('id', c.id);
                if (error) return toast('Wissen mislukt: ' + errText(error));
                await loadPlaying(); renderPlaying();
              } }) : null),
            h('div', { class: 'msg-body', text: c.body }));
        }) : h('p', { class: 'muted', style: 'margin:0;font-size:14px', text: 'Nog geen opmerkingen.' })),
        form,
        h('div', { class: 'actions' },
          h('button', { type: 'button', text: S.open.has('p-' + id) ? 'Speler sluiten' : '▶ Luisteren', onclick: () => { const k = 'p-' + id; S.open.has(k) ? S.open.delete(k) : S.open.add(k); renderPlaying(); } }),
          h('a', { href: 'https://open.spotify.com/track/' + id, target: '_blank', rel: 'noopener', text: 'Open in Spotify' }),
          confirming
            ? h('span', { class: 'confirm' }, 'Van de lijst halen? ',
                h('button', { type: 'button', class: 'danger', text: 'Ja, weg', onclick: e => togglePlaying(id, e.currentTarget) }),
                h('button', { type: 'button', text: 'Annuleren', onclick: () => { S.confirmRemove = null; renderPlaying(); } }))
            : h('button', { type: 'button', class: 'subtle', text: 'Van de lijst halen', onclick: () => { S.confirmRemove = id; renderPlaying(); } })),
        player);
    })));
  if (focusedId) { const el = document.getElementById(focusedId); if (el) { el.focus(); if (el.setSelectionRange) el.setSelectionRange(el.value.length, el.value.length); } }
}

function emptyState() {
  const connected = S.status?.connected;
  return h('div', { class: 'empty' },
    h('p', { style: 'margin:0 0 6px;font-weight:600;color:var(--ink)', text: 'Nog geen nummers' }),
    connected ? 'De playlist is gekoppeld maar nog leeg, of de eerste sync loopt nog.' : 'Jonas moet de Spotify-playlist nog koppelen. Dat gebeurt via de pagina connect.html.');
}

boot().catch(e => { main.replaceChildren(h('p', { class: 'error', text: errText(e) })); });
