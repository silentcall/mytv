(function (root) {
  'use strict';
  function splitInfo(line) {
    let quote = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) { if (c === quote) quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === ',') return [line.slice(0, i), line.slice(i + 1).trim()];
    }
    return [line, ''];
  }
  function attributes(text) {
    const out = {};
    const pattern = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
    for (const match of text.matchAll(pattern)) out[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4];
    return out;
  }
  function cleanName(name) {
    return name.replace(/\s*\[(?:geo-blocked|not 24\/7)\]/gi, '').replace(/\s*\(\d{3,4}p\)/gi, '').trim();
  }
  function resolveUrl(value, base) {
    try {
      const url = base ? new URL(value, base) : new URL(value);
      return ['https:', 'http:', 'tvbus:', 'tvcar:', 'rtsp:', 'rtmp:', 'udp:'].includes(url.protocol) ? url.href : null;
    } catch { return null; }
  }
  function parse(text, options = {}) {
    if (typeof text !== 'string' || text.length > 10 * 1024 * 1024) throw new Error('Choose a text playlist smaller than 10 MB.');
    if (/^\s*</.test(text)) throw new Error('The address returned a web page rather than an M3U playlist.');
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    if (lines.some(line => /^#EXT-X-(?:TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE):/.test(line.trim()))) {
      throw new Error('This is a single HLS stream, not a channel playlist. Add it as a stream URL.');
    }
    let pending = null;
    const entries = [];
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF:')) {
        const [info, name] = splitInfo(line);
        const attrs = attributes(info);
        pending = { name: cleanName(name || attrs['tvg-name'] || 'Unnamed channel'), tvgId: attrs['tvg-id'] || '', group: attrs['group-title'] || options.group || 'My playlist', logo: attrs['tvg-logo'] || '', headers: {}, drm: false, provider: attrs['x-provider'] || '', radio: attrs.radio === 'true' || attrs['tvg-type'] === 'radio' };
      } else if (line.startsWith('#EXTGRP:') && pending) pending.group = line.slice(8).trim();
      else if (line.startsWith('#EXTVLCOPT:') && pending) {
        const [key, ...value] = line.slice(11).split('=');
        if (/^http-(?:referrer|referer|user-agent|cookie)$/i.test(key)) pending.headers[key.toLowerCase()] = value.join('=');
      } else if (line.startsWith('#EXTHTTP:') && pending) {
        try { Object.assign(pending.headers, JSON.parse(line.slice(9))); } catch { /* Invalid optional metadata is ignored. */ }
      } else if (line.startsWith('#KODIPROP:') && pending && /license_(?:type|key)=/i.test(line)) pending.drm = true;
      else if (!line.startsWith('#')) {
        const [rawUrl, headerText] = line.split('|', 2);
        const url = resolveUrl(rawUrl.trim(), options.baseUrl);
        if (!url) { pending = null; continue; }
        const entry = pending || { name: 'Channel ' + (entries.length + 1), tvgId: '', group: options.group || 'My playlist', logo: '', headers: {}, drm: false, provider: '', radio: false };
        if (headerText) for (const [key, value] of new URLSearchParams(headerText)) entry.headers[key] = value;
        entry.url = url;
        const path = new URL(url).pathname.toLowerCase();
        const parsedUrl = new URL(url);
        const dm = ['www.dailymotion.com', 'dailymotion.com'].includes(parsedUrl.hostname) && /^\/video\/[a-zA-Z0-9]+\/?$/.test(parsedUrl.pathname);
        const youtube = ['www.youtube.com', 'youtube.com'].includes(parsedUrl.hostname) && parsedUrl.pathname === '/watch' && /^[A-Za-z0-9_-]{11}$/.test(parsedUrl.searchParams.get('v') || '');
        entry.type = entry.provider ? 'resolver' : youtube ? 'youtube' : dm ? 'dailymotion' : path.endsWith('.mpd') ? 'dash' : path.endsWith('.ts') ? 'ts' : /\.(mp4|webm|ogg)$/.test(path) ? 'file' : 'hls';
        entries.push(entry);
        pending = null;
      }
    }
    if (!entries.length) throw new Error('No stream URLs were found in this playlist.');
    return entries;
  }
  function group(entries) {
    const map = new Map();
    for (const entry of entries) {
      const key = entry.tvgId ? entry.tvgId.split('@')[0].toLowerCase() : cleanName(entry.name).toLowerCase();
      if (!map.has(key)) map.set(key, { id: key, name: entry.name, group: entry.group, logo: entry.logo, sources: [] });
      const channel = map.get(key);
      if (!channel.sources.some(source => source.url === entry.url && JSON.stringify(source.headers) === JSON.stringify(entry.headers))) channel.sources.push(entry);
    }
    return [...map.values()];
  }
  function limitation(source, protocol = 'https:') {
    if (source.provider) return `Needs ${source.provider} source resolver`;
    if (source.drm) return 'Needs a licensed DRM player';
    if (!/^https?:\/\//i.test(source.url)) return 'Needs a native TV app';
    if (source.type === 'ts') return 'Transport stream needs a native TV app';
    if (protocol === 'https:' && source.url.startsWith('http:')) return 'HTTP stream blocked on HTTPS';
    if (Object.keys(source.headers || {}).some(key => /referr?er|user-agent|cookie|authorization/i.test(key))) return 'Needs provider request headers';
    return '';
  }
  function serialize(entries) {
    const safe = value => String(value || '').replace(/[\r\n"]/g, ' ').trim();
    const lines = ['#EXTM3U'];
    for (const e of entries) {
      lines.push(`#EXTINF:-1 tvg-id="${safe(e.tvgId)}" group-title="${safe(e.group)}" tvg-logo="${safe(e.logo)}"${e.provider ? ` x-provider="${safe(e.provider)}"` : ''}${e.radio ? ' radio="true"' : ''},${safe(e.name)}`);
      if (Object.keys(e.headers || {}).length) lines.push('#EXTHTTP:' + JSON.stringify(e.headers));
      if (e.drm) lines.push('#KODIPROP:inputstream.adaptive.license_type=unknown');
      lines.push(e.url);
    }
    return lines.join('\n') + '\n';
  }
  const api = { parse, group, limitation, cleanName, serialize };
  root.TVPlaylist = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
