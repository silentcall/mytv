'use strict';
const P = globalThis.TVPlaylist;
const $ = id => document.getElementById(id);
const PUBLIC_URL = 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/my.m3u';
const PUBLIC_IDS = new Set(['8tv','astroawani','awesometv','beritartm','bernamatv','maahtv','ntv7','okey','rtmasean','rtmparlimendewannegara','rtmparlimendewanrakyat','selangortv','sukanrtm','suketv','tv1','tv2','tv3','tv6','tv9','tvikim','tvs','tvalhijrah','didiktvkpm','dramasangat']);
const PUBLIC_ADDITIONS = P.parse(globalThis.TV_SEED);
const retiredSource = entry => /^https:\/\/(?:www\.)?dailymotion\.com\/video\/x8dbnq6(?:[/?#]|$)/i.test(entry.url);
const radioSource = entry => entry.radio || /(?:^|\b)radio(?:\b|$)/i.test(entry.group || '') || /\.(?:mp3|aac|m4a)(?:[?#]|$)/i.test(entry.url);
const CACHE_KEY = 'my-tv-library-v2';
const FAVORITES_KEY = 'my-tv-favorites-v2';
function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
const favoriteIds = read(FAVORITES_KEY, []);
let favorites = new Set(Array.isArray(favoriteIds) ? favoriteIds.filter(id => typeof id === 'string') : []);
let onlyFavorites = false;
let entries = [];
let channels = [];
let activeId = '';
let activeSource = '';
let video = null;
let embedded = false;
let checkTimer;
let hls = null;
let dash = null;
let playRevision = 0;
let libraryRevision = 0;
let timeout;
let refreshUrl = PUBLIC_URL;
let publicMode = true;
let label = 'TV channels';
let muted = true;
let waitingForGesture = false;
let failed = false;
let refreshing = false;
const scripts = new Map();
const limitation = source => P.limitation(source, location.protocol === 'file:' ? 'https:' : location.protocol);

function status(message, state) {
  $('status').textContent = message;
  if (state) $('play-state').textContent = state;
}
function screen(message, retry = false) {
  $('player-message').hidden = false;
  $('screen-status').textContent = message;
  $('retry').hidden = !retry;
  $('retry').textContent = waitingForGesture ? 'Play channel' : 'Retry channel';
}
function persistLibrary() {
  return save(CACHE_KEY, { text: P.serialize(entries), label, refreshUrl, publicMode });
}
function renderChannels() {
  const focused = document.activeElement?.dataset.channel;
  const query = $('search').value.trim().toLocaleLowerCase();
  const group = $('group-filter').value;
  const visible = channels.filter(c => (!onlyFavorites || favorites.has(c.id)) && (!group || c.group === group) && `${c.name} ${c.group}`.toLocaleLowerCase().includes(query));
  const list = $('channels');
  list.replaceChildren();
  for (const channel of visible) {
    const row = document.createElement('div');
    row.className = `channel-row${channel.id === activeId ? ' selected' : ''}`;
    row.setAttribute('role', 'listitem');
    const pick = document.createElement('button');
    pick.className = 'channel-pick';
    pick.type = 'button';
    pick.dataset.channel = channel.id;
    pick.setAttribute('aria-label', `Play ${channel.name}`);
    pick.setAttribute('aria-current', channel.id === activeId ? 'true' : 'false');
    const icon = document.createElement('span');
    icon.className = 'channel-icon';
    icon.textContent = channel.name.replace(/^TV\s*/i, '').slice(0, 2).toUpperCase();
    const info = document.createElement('span');
    info.className = 'channel-info';
    const name = document.createElement('span');
    name.className = 'channel-name';
    name.textContent = channel.name;
    const meta = document.createElement('span');
    meta.className = 'channel-type';
    const eligible = channel.sources.filter(s => !limitation(s)).length;
    meta.textContent = eligible ? `${channel.sources.length} ${channel.sources.length === 1 ? 'source' : 'sources'} · ${channel.group}` : (limitation(channel.sources[0]) || 'Needs another player');
    info.append(name, meta);
    pick.append(icon, info);
    pick.addEventListener('click', () => playChannel(channel.id));
    const star = document.createElement('button');
    star.type = 'button';
    star.className = `remove-button${favorites.has(channel.id) ? ' saved' : ''}`;
    star.textContent = favorites.has(channel.id) ? '★' : '☆';
    star.setAttribute('aria-label', `Favorite ${channel.name}`);
    star.setAttribute('aria-pressed', String(favorites.has(channel.id)));
    star.addEventListener('click', () => {
      favorites.has(channel.id) ? favorites.delete(channel.id) : favorites.add(channel.id);
      save(FAVORITES_KEY, [...favorites]);
      renderChannels();
      const replacement = [...list.querySelectorAll('.channel-pick')].find(button => button.dataset.channel === channel.id);
      (replacement || $('search')).focus();
    });
    row.append(pick, star);
    list.append(row);
  }
  $('channel-count').textContent = `${channels.length} channels`;
  $('empty').hidden = visible.length > 0;
  if (focused) [...list.querySelectorAll('.channel-pick')].find(b => b.dataset.channel === focused)?.focus();
}
function renderGroups() {
  const selected = $('group-filter').value;
  $('group-filter').replaceChildren(new Option('All groups', ''));
  for (const group of [...new Set(channels.map(c => c.group))].sort()) $('group-filter').add(new Option(group, group));
  if ([...$('group-filter').options].some(o => o.value === selected)) $('group-filter').value = selected;
}
function renderSources(channel) {
  $('source-select').replaceChildren();
  channel.sources.forEach((source, i) => {
    const reason = limitation(source);
    const text = `Source ${i + 1} · ${reason || source.type.toUpperCase()}`;
    const option = new Option(text, String(i));
    option.selected = source.url === activeSource;
    $('source-select').add(option);
  });
}
function setLibrary(next, options = {}) {
  const old = options.merge ? entries : [];
  const incoming = [...(options.publicMode ? PUBLIC_ADDITIONS : []), ...old, ...next].filter(entry => !retiredSource(entry) && !radioSource(entry));
  if (!incoming.length) throw new Error('No TV sources remain. Radio and retired sources are excluded from this player.');
  entries = P.group(incoming).flatMap(c => c.sources);
  channels = P.group(entries);
  libraryRevision++;
  publicMode = options.publicMode ?? false;
  refreshUrl = options.refreshUrl ?? null;
  label = options.label || 'My playlists';
  $('library-label').textContent = label;
  persistLibrary();
  renderGroups();
  renderChannels();
  const current = channels.find(c => c.id === activeId);
  if (options.keepPlaying && current && (embedded || (video && !video.paused))) renderSources(current);
  else {
    const last = read('my-tv-last-v2', '');
    const initial = channels.find(c => c.id === options.selectId) || current || channels.find(c => c.id === last) || channels.find(c => c.sources.some(s => !limitation(s))) || channels[0];
    if (initial) playChannel(initial.id);
  }
}
async function fetchPlaylist(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Use an HTTPS playlist URL.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(parsed.href, { signal: controller.signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`Playlist server returned HTTP ${response.status}.`);
    if (Number(response.headers.get('content-length') || 0) > 10 * 1024 * 1024) throw new Error('Playlist is larger than 10 MB.');
    const text = await response.text();
    return P.parse(text, { baseUrl: response.url || parsed.href, group: 'My playlist' });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Playlist server did not respond within 12 seconds.');
    throw error;
  } finally { clearTimeout(timer); }
}
async function refreshLibrary() {
  if (!refreshUrl || refreshing) {
    if (!refreshUrl) $('library-status').textContent = 'For a merged or local playlist, import updated files or URLs to add fresh sources.';
    return;
  }
  refreshing = true;
  const revision = libraryRevision;
  const url = refreshUrl;
  const wasPublic = publicMode;
  const oldLabel = label;
  $('refresh').disabled = true;
  $('library-status').textContent = 'Checking for updated playlist sources…';
  try {
    let loaded = await fetchPlaylist(url);
    if (revision !== libraryRevision) return;
    if (wasPublic) loaded = loaded.filter(e => PUBLIC_IDS.has(e.tvgId.split('.')[0].toLowerCase())).map(e => ({ ...e, group: 'Malaysia' }));
    if (!loaded.length) throw new Error('The updated list contains no matching channels.');
    setLibrary(loaded, { publicMode: wasPublic, refreshUrl: url, label: oldLabel, keepPlaying: true });
    $('library-status').textContent = `Updated ${channels.length} channels and ${entries.length} source entries. Playback is checked when you choose a channel.`;
  } catch (error) {
    if (revision === libraryRevision) $('library-status').textContent = `Could not refresh the playlist. Keeping your current list. ${error.message || 'The host may block browser access.'}`;
  } finally { refreshing = false; $('refresh').disabled = false; }
}
function release() {
  clearTimeout(timeout);
  clearTimeout(checkTimer);
  $('check-video').disabled = false;
  $('check-video').textContent = 'Check video · 10s';
  if (hls) { hls.destroy(); hls = null; }
  if (dash) { dash.reset(); dash = null; }
  if (video) { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); video = null; }
  embedded = false;
  $('video-slot').replaceChildren();
}
function script(url, ready) {
  if (ready()) return Promise.resolve();
  if (!scripts.has(url)) scripts.set(url, new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    const timer = setTimeout(() => { tag.remove(); scripts.delete(url); reject(new Error('Player library download timed out.')); }, 12000);
    tag.src = url;
    tag.onload = () => { clearTimeout(timer); if (ready()) resolve(); else { scripts.delete(url); reject(new Error('Player library unavailable.')); } };
    tag.onerror = () => { clearTimeout(timer); tag.remove(); scripts.delete(url); reject(new Error('Could not download the playback library.')); };
    document.head.append(tag);
  }));
  return scripts.get(url);
}
function playChannel(id, manualSource = null) {
  const channel = channels.find(c => c.id === id);
  if (!channel) return;
  const revision = ++playRevision;
  release();
  activeId = id;
  failed = false;
  waitingForGesture = false;
  save('my-tv-last-v2', id);
  $('now-title').textContent = channel.name;
  $('verification').textContent = 'This channel has not passed a video check in this session.';
  const indices = manualSource === null ? channel.sources.map((_, i) => i).filter(i => !limitation(channel.sources[i])) : [manualSource];
  activeSource = channel.sources[indices[0] ?? 0]?.url || '';
  renderSources(channel);
  renderChannels();
  if (!indices.length || limitation(channel.sources[indices[0]])) {
    failed = true;
    const reason = [...new Set(channel.sources.map(limitation).filter(Boolean))].join('. ');
    status(reason + '. Choose another source or use a native player for this entry.', 'NEEDS ANOTHER PLAYER');
    screen(reason);
    return;
  }
  attempt(channel, indices, 0, revision);
}
async function attempt(channel, indices, position, revision) {
  if (revision !== playRevision) return;
  release();
  const sourceIndex = indices[position];
  const source = channel.sources[sourceIndex];
  activeSource = source.url;
  $('verification').textContent = 'This source has not passed a video check in this session.';
  $('mute').disabled = false;
  $('mute').textContent = muted ? 'Turn sound on' : 'Mute sound';
  $('source-select').value = String(sourceIndex);
  if (source.type === 'dailymotion' || source.type === 'youtube') {
    const id = source.type === 'youtube' ? new URL(source.url).searchParams.get('v') : new URL(source.url).pathname.split('/')[2];
    const frame = document.createElement('iframe');
    frame.src = source.type === 'youtube'
      ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=${muted ? '1' : '0'}&playsinline=1`
      : `https://www.dailymotion.com/embed/video/${encodeURIComponent(id)}?autoplay=1&mute=${muted ? '1' : '0'}`;
    frame.title = `${channel.name} — broadcaster live player`;
    frame.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media');
    frame.setAttribute('allowfullscreen', '');
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    $('video-slot').replaceChildren(frame);
    embedded = true;
    $('player-message').hidden = true;
    $('mute').disabled = true;
    $('mute').textContent = 'Sound: player controls';
    status('Broadcaster player opened. Use its play/sound controls. If unavailable, select another source.', 'PROVIDER PLAYER');
    $('verification').textContent = 'Embedded feed: confirm picture and sound manually. This page cannot inspect video inside another provider’s player.';
    return;
  }
  status(`Connecting to ${channel.name} · source ${sourceIndex + 1} of ${channel.sources.length}…`, 'CONNECTING');
  screen(`Connecting to ${channel.name}…`);
  const element = document.createElement('video');
  element.controls = true;
  element.autoplay = true;
  element.muted = muted;
  element.playsInline = true;
  video = element;
  $('video-slot').replaceChildren(element);
  let rejected = false;
  const current = () => revision === playRevision && video === element && !rejected;
  const fail = message => {
    if (!current()) return;
    rejected = true;
    clearTimeout(timeout);
    if (position + 1 < indices.length) attempt(channel, indices, position + 1, revision);
    else {
      failed = true;
      release();
      status(`${message} The source may be offline, restricted, expired, or blocked in browsers.`, 'UNAVAILABLE');
      screen('No playable source responded for this channel.', true);
    }
  };
  const armTimeout = () => { clearTimeout(timeout); timeout = setTimeout(() => fail('Playback did not start within 20 seconds.'), 20000); };
  const start = () => {
    if (!current()) return;
    element.play().catch(error => {
      if (!current()) return;
      if (error.name === 'NotAllowedError') {
        clearTimeout(timeout);
        waitingForGesture = true;
        status('Press Play channel to allow playback.', 'PRESS PLAY');
        screen('Your browser needs a click to start playback.', true);
      } else if (error.name !== 'AbortError') fail('The browser could not play this source.');
    });
  };
  element.addEventListener('playing', () => {
    if (!current()) return;
    clearTimeout(timeout);
    waitingForGesture = false;
    failed = false;
    $('player-message').hidden = true;
    status(`${channel.name} is playing · source ${sourceIndex + 1} · ${source.type.toUpperCase()}`, 'PLAYING');
  });
  element.addEventListener('waiting', () => { if (current() && !waitingForGesture) { status('Buffering…', 'BUFFERING'); armTimeout(); } });
  element.addEventListener('pause', () => { if (current() && !element.ended && element.readyState >= 2) { clearTimeout(timeout); status('Paused.', 'PAUSED'); } });
  element.addEventListener('ended', () => { if (current()) { clearTimeout(timeout); status('This stream has ended.', 'ENDED'); } });
  element.addEventListener('volumechange', () => { if (current()) { muted = element.muted; $('mute').textContent = muted ? 'Turn sound on' : 'Mute sound'; } });
  element.addEventListener('error', () => fail('The stream returned a playback error.'));
  armTimeout();
  try {
    if (source.type === 'dash') {
      await script('https://cdn.dashjs.org/latest/modern/umd/dash.all.min.js', () => Boolean(window.dashjs));
      if (!current()) return;
      dash = window.dashjs.MediaPlayer().create();
      dash.on(window.dashjs.MediaPlayer.events.ERROR, () => fail('The DASH stream could not be loaded.'));
      element.addEventListener('canplay', start, { once: true });
      dash.initialize(element, source.url, false);
    } else if (source.type === 'file' || element.canPlayType('application/vnd.apple.mpegurl')) {
      element.src = source.url;
      start();
    } else {
      await script('https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js', () => Boolean(window.Hls));
      if (!current()) return;
      if (!window.Hls.isSupported()) { fail('This browser does not support HLS playback.'); return; }
      hls = new window.Hls();
      hls.on(window.Hls.Events.MANIFEST_PARSED, start);
      hls.on(window.Hls.Events.ERROR, (_, data) => { if (data.fatal) fail('The HLS stream could not be loaded.'); });
      hls.loadSource(source.url);
      hls.attachMedia(element);
    }
  } catch (error) { fail(error.message || 'Could not initialize the player.'); }
}

$('import-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('form-error').hidden = true;
  const url = $('playlist-url').value.trim();
  const file = $('playlist-file').files[0];
  const pasted = $('playlist-text').value.trim();
  if ([Boolean(url), Boolean(file), Boolean(pasted)].filter(Boolean).length !== 1) {
    $('form-error').textContent = 'Use one input: a playlist URL, a file, or pasted text.';
    $('form-error').hidden = false;
    return;
  }
  $('import-submit').disabled = true;
  try {
    let loaded;
    if (file) { if (file.size > 10 * 1024 * 1024) throw new Error('Choose a playlist smaller than 10 MB.'); loaded = P.parse(await file.text()); }
    else if (url) loaded = await fetchPlaylist(url);
    else loaded = P.parse(/^https?:\/\/\S+$/.test(pasted) ? '#EXTM3U\n#EXTINF:-1,My stream\n' + pasted : pasted);
    const merge = $('import-mode').value === 'merge';
    const imported = P.group(loaded);
    const first = imported.find(c => c.sources.some(s => !limitation(s))) || imported[0];
    setLibrary(loaded, { merge, selectId: first?.id, label: merge ? 'My consolidated playlists' : file?.name || 'My playlist', refreshUrl: !merge && url ? url : null });
    $('library-status').textContent = `Imported ${loaded.length} source entries. Your library has ${channels.length} channels. Saved locally where browser storage is available.`;
    $('import-form').reset();
  } catch (error) {
    $('form-error').textContent = error.message || 'Could not import the playlist. The host may block browser access.';
    $('form-error').hidden = false;
  } finally { $('import-submit').disabled = false; }
});
$('source-select').addEventListener('change', e => playChannel(activeId, Number(e.target.value)));
$('retry').addEventListener('click', () => {
  if (waitingForGesture && video) {
    waitingForGesture = false;
    video.play().catch(() => { waitingForGesture = true; status('Use the video controls or try a different source.', 'PRESS PLAY'); });
  } else playChannel(activeId);
});
function stepChannel(delta) {
  const eligible = channels.filter(c => c.sources.some(s => !limitation(s)));
  if (!eligible.length) return;
  const index = eligible.findIndex(c => c.id === activeId);
  playChannel(eligible[(index + delta + eligible.length) % eligible.length].id);
}
$('previous').addEventListener('click', () => stepChannel(-1));
$('next').addEventListener('click', () => stepChannel(1));
$('mute').addEventListener('click', () => { muted = !muted; if (video) video.muted = muted; $('mute').textContent = muted ? 'Turn sound on' : 'Mute sound'; });
$('check-video').addEventListener('click', () => {
  if (embedded) {
    $('verification').textContent = 'Automatic checking is unavailable inside the broadcaster embed. Confirm moving picture and sound manually, or choose a direct HLS source to run the 10-second check.';
    return;
  }
  if (!video || video.paused || video.readyState < 2) {
    $('verification').textContent = 'Start the channel and wait for its picture, then run the video check.';
    return;
  }
  clearTimeout(checkTimer);
  const element = video;
  const revision = playRevision;
  const probe = globalThis.TVPlaybackCheck.createProbe(globalThis.TVPlaybackCheck.sample(element));
  $('check-video').disabled = true;
  $('check-video').textContent = 'Checking…';
  const tick = () => {
    if (revision !== playRevision || video !== element) return;
    const result = probe.update(globalThis.TVPlaybackCheck.sample(element));
    if (result.status === 'checking') {
      $('verification').textContent = `Checking advancing video: ${result.seconds.toFixed(1)} / 10 seconds…`;
      checkTimer = setTimeout(tick, 500);
      return;
    }
    $('check-video').disabled = false;
    $('check-video').textContent = 'Check video · 10s';
    $('verification').textContent = result.status === 'passed'
      ? `Video check passed on this device: 10 seconds of advancing playback at ${result.width} × ${result.height}${result.frames === null ? '; frame counter unavailable' : `, ${result.frames} presented frames`}. Unmute to confirm sound. This is a short check, not a reliability guarantee.`
      : 'Video check did not pass within 20 seconds. The stream stalled, had no decoded picture, or did not keep advancing. Try another source.';
  };
  $('verification').textContent = 'Checking advancing video: 0 / 10 seconds…';
  checkTimer = setTimeout(tick, 500);
});
async function fullscreen() {
  try { if ($('player-frame').requestFullscreen) await $('player-frame').requestFullscreen(); else if (video?.webkitEnterFullscreen) video.webkitEnterFullscreen(); else status('Fullscreen is not available in this browser.'); }
  catch { status('Fullscreen was blocked by this browser.'); }
}
$('fullscreen').addEventListener('click', fullscreen);
$('search').addEventListener('input', renderChannels);
$('group-filter').addEventListener('change', renderChannels);
$('favorites-filter').addEventListener('click', () => { onlyFavorites = !onlyFavorites; $('favorites-filter').setAttribute('aria-pressed', String(onlyFavorites)); renderChannels(); });
$('refresh').addEventListener('click', refreshLibrary);
$('reset').addEventListener('click', () => {
  setLibrary(P.parse(globalThis.TV_SEED), { publicMode: true, refreshUrl: PUBLIC_URL, label: 'TV channels' });
  $('library-status').textContent = 'Loaded the bundled Malaysia snapshot. Checking for updates…';
  refreshLibrary();
});
$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([P.serialize(entries.filter(e => !['dailymotion', 'youtube', 'resolver'].includes(e.type)))], { type: 'audio/x-mpegurl;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'my-tv-channels.m3u';
  document.body.append(link);
  link.click();
  link.remove();
  $('library-status').textContent = 'Exported direct stream entries. Provider web-player embeds are omitted from the exported M3U.';
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener('keydown', event => {
  const target = document.activeElement;
  if (/INPUT|TEXTAREA|SELECT/.test(target?.tagName)) return;
  if (['ArrowUp', 'ArrowDown'].includes(event.key) && target?.classList.contains('channel-pick')) {
    const buttons = [...document.querySelectorAll('.channel-pick')];
    const next = buttons.indexOf(target) + (event.key === 'ArrowDown' ? 1 : -1);
    if (buttons[next]) { event.preventDefault(); buttons[next].focus(); }
  } else if (event.key === 'PageDown' || event.key === 'PageUp') { event.preventDefault(); stepChannel(event.key === 'PageDown' ? 1 : -1); }
});

const cached = read(CACHE_KEY, null);
try {
  if (!cached || typeof cached.text !== 'string') throw new Error();
  setLibrary(P.parse(cached.text), { publicMode: Boolean(cached.publicMode), refreshUrl: cached.refreshUrl || null, label: cached.label || 'My playlist' });
  $('library-status').textContent = 'Loaded your saved playlist.';
} catch {
  setLibrary(P.parse(globalThis.TV_SEED), { publicMode: true, refreshUrl: PUBLIC_URL, label: 'TV channels' });
  $('library-status').textContent = 'Loaded the bundled Malaysia snapshot. These sources have not been live-tested here.';
}
if (refreshUrl) refreshLibrary();
