// Bandstem — stemmen op de nummers uit de gedeelde Spotify-playlist.

const INSTR = { zang: 'Zang', gitaar: 'Gitaar', bas: 'Bas', drums: 'Drums', piano: 'Piano', coach: 'Coach' };
const instrOption = k => k === 'coach' ? 'Coach (speelt niet mee)' : INSTR[k];
const DIFF = { 1: 'Makkelijk', 2: 'Te doen', 3: 'Moeilijk' };
const VOTE = { super: '★ Super', yes: 'Ja', maybe: 'Misschien', no: 'Nee' };
const POINTS = { super: 3, yes: 2, maybe: 1, no: -2 };
const SUPER_MAX = 3;
const NEW_DAYS = 7;

const S = {
  sb: null, me: null, code: '',
  members: [], songs: [], votes: new Map(), status: null,
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
  const instr = h('select', { class: 'select', id: 'newinstr' }, Object.keys(INSTR).map(k => h('option', { value: k, text: instrOption(k) })));
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
  S.view = location.hash === '#resultaten' ? 'resultaten' : 'stemmen';
  renderHeader();
  main.replaceChildren(h('p', { class: 'muted', text: 'Nummers laden…' }));
  await loadAll();
  render();
  S.sb.channel('band-votes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'band_votes' }, debounce(async () => { await loadVotes(); if (S.view === 'resultaten') render(); }, 500))
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
async function refreshQuiet() {
  const before = S.songs.map(s => s.spotify_id).join();
  await loadAll();
  const changed = S.songs.map(s => s.spotify_id).join() !== before;
  if (S.view === 'resultaten' || (changed && !document.activeElement?.matches('textarea'))) render();
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

  for (const v of ['stemmen', 'resultaten']) {
    const t = document.getElementById('tab-' + v);
    t.setAttribute('aria-selected', String(S.view === v));
    t.onclick = () => { S.view = v; history.replaceState(null, '', v === 'resultaten' ? '#resultaten' : '#'); renderHeader(); render(); window.scrollTo({ top: 0 }); };
  }
}

function render() { S.view === 'resultaten' ? renderResults() : renderVoting(); }

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
      h('div', { class: 'actions' }, h('a', { href: 'https://open.spotify.com/track/' + s.spotify_id, target: '_blank', rel: 'noopener', text: 'Open in Spotify' })));
  }));

  main.replaceChildren(
    h('div', { class: 'field' }, h('span', { class: 'label', text: 'Wie heeft al gestemd' }), people),
    h('div', { class: 'toolbar' }, chips, sortSel),
    h('p', { class: 'legend', text: `Score: ★ Super +3, Ja +2, Misschien +1, Nee −2. Iedereen heeft ${SUPER_MAX} superlikes. Moeilijkheid geeft elk bandlid voor zijn eigen instrument; de coach speelt niet mee en geeft advies.` }),
    rows.length ? list : h('div', { class: 'empty', text: 'Geen nummers in deze selectie.' }),
  );
}

function emptyState() {
  const connected = S.status?.connected;
  return h('div', { class: 'empty' },
    h('p', { style: 'margin:0 0 6px;font-weight:600;color:var(--ink)', text: 'Nog geen nummers' }),
    connected ? 'De playlist is gekoppeld maar nog leeg, of de eerste sync loopt nog.' : 'Jonas moet de Spotify-playlist nog koppelen. Dat gebeurt via de pagina connect.html.');
}

boot().catch(e => { main.replaceChildren(h('p', { class: 'error', text: errText(e) })); });
