// Gedeelde Spotify-code: gebruikt door de koppelpagina (browser) en door de automatische sync (GitHub Action).

const API = 'https://api.spotify.com/v1';
export const TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SCOPES = 'playlist-read-private playlist-read-collaborative';

// Haalt het playlist-id uit een link, een spotify:-uri of een kaal id.
export function parsePlaylistId(input) {
  const s = String(input || '').trim();
  const m = s.match(/playlist[/:]([A-Za-z0-9]{22})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9]{22}$/.test(s)) return s;
  return null;
}

async function get(token, url, tries = 0) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 429 && tries < 3) {
    const wait = Number(res.headers.get('Retry-After') || 2);
    await new Promise(r => setTimeout(r, Math.min(wait, 30) * 1000));
    return get(token, url, tries + 1);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* geen json */ }
    const err = new Error(`Spotify ${res.status}${detail ? ': ' + detail : ''}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function pickImage(images) {
  if (!Array.isArray(images) || !images.length) return null;
  const sorted = [...images].sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find(i => (i.width || 0) >= 120) || sorted[sorted.length - 1]).url;
}

// Leest naam + alle nummers van een playlist.
export async function fetchPlaylist(token, playlistId) {
  const meta = await get(token, `${API}/playlists/${playlistId}?fields=name`);
  const songs = [];
  let url = `${API}/playlists/${playlistId}/items?limit=50`;
  let position = 0;
  while (url) {
    let page;
    try {
      page = await get(token, url);
    } catch (e) {
      if (e.status === 403 || e.status === 404) {
        throw new Error('Spotify geeft de nummers van deze playlist niet vrij. Je moet eigenaar of medewerker van de playlist zijn. (' + e.message + ')');
      }
      throw e;
    }
    for (const it of page.items || []) {
      const t = it.item || it.track;
      position++;
      if (!t || t.is_local || !t.id || (t.type && t.type !== 'track')) continue;
      songs.push({
        spotify_id: t.id,
        title: t.name || '',
        artists: (t.artists || []).map(a => a.name).join(', '),
        album: t.album?.name || '',
        image_url: pickImage(t.album?.images),
        duration_ms: t.duration_ms ?? null,
        added_at: it.added_at || null,
        position: position - 1,
      });
    }
    url = page.next;
  }
  // dubbele nummers in de playlist maar één keer tellen
  const seen = new Set();
  return { name: meta.name || 'Playlist', songs: songs.filter(s => !seen.has(s.spotify_id) && seen.add(s.spotify_id)) };
}

// Nieuw access token via een refresh token (PKCE: alleen client_id nodig).
export async function refreshAccessToken(clientId, refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error('Spotify-token vernieuwen mislukt: ' + (data.error_description || data.error || res.status));
    err.code = data.error;
    throw err;
  }
  return data; // { access_token, refresh_token? , expires_in }
}
