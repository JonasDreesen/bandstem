// Automatische sync: haalt de playlist op bij Spotify en zet de nummers in Supabase.
// Draait via GitHub Actions (.github/workflows/sync.yml). Nodig: secret SUPABASE_SECRET_KEY.

import fs from 'node:fs';
import { fetchPlaylist, refreshAccessToken } from '../js/spotify.js';

const config = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!KEY) { console.error('SUPABASE_SECRET_KEY ontbreekt (zet hem bij Settings > Secrets and variables > Actions).'); process.exit(1); }

const base = config.supabaseUrl.replace(/\/$/, '');
const headers = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

async function sb(path, opts = {}) {
  const res = await fetch(base + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}
const saveSettings = (patch) => sb('/rest/v1/band_settings?id=eq.1', { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } });

const [settings] = await sb('/rest/v1/band_settings?id=eq.1&select=playlist_id,spotify_refresh_token');
if (!settings?.spotify_refresh_token || !settings?.playlist_id) {
  console.log('Nog niet gekoppeld met Spotify. Open connect.html op de site om te koppelen.');
  process.exit(0);
}

try {
  const tok = await refreshAccessToken(config.spotifyClientId, settings.spotify_refresh_token);
  if (tok.refresh_token && tok.refresh_token !== settings.spotify_refresh_token) {
    await saveSettings({ spotify_refresh_token: tok.refresh_token });
  }
  const { name, songs } = await fetchPlaylist(tok.access_token, settings.playlist_id);
  const n = await sb('/rest/v1/rpc/band_apply_sync', { method: 'POST', body: JSON.stringify({ p_songs: songs, p_playlist_name: name }) });
  console.log(`Klaar: "${name}", ${n} nummers bijgewerkt.`);
} catch (e) {
  const msg = e.code === 'invalid_grant'
    ? 'De Spotify-koppeling is verlopen. Open connect.html en koppel opnieuw.'
    : String(e.message || e).slice(0, 400);
  console.error(msg);
  await saveSettings({ last_sync_error: msg }).catch(() => {});
  // Niet laten falen: anders stuurt GitHub elk half uur een mail. De site toont de fout.
}
