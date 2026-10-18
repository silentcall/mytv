My TV Player — TV-only GitHub Pages package

Extract this ZIP and upload ALL files to the root of your GitHub repository.
In Settings > Pages choose Deploy from a branch, your default branch, /(root).
Open the Pages URL shown there. Playback starts muted; use Turn sound on.

The snapshot contains 32 TV/video channels and 37 source candidates, combining
23 TV/video catalogue entries with the existing Malaysian TV channels. No radio
stations from the supplied catalogue are included. Radio metadata, Radio groups
and common audio-file sources are also excluded from imports and saved lists.
Unlabelled audio-only HLS streams cannot be identified without playback.

Astro Awani uses the direct CloudFront index.m3u8 URL configured in the supplied
TV Malaysia 4.0.0 catalogue. CNA and Spongebob use embedded YouTube players.
Fitrah is labelled Aura feed because both entries use the same configured URL.

Some catalogue channels require provider resolvers, request headers or licensed
DRM playback. These requirements are shown beside their sources; the site does
not pretend that provider page URLs are direct video streams. Native resolvers
from the APK are not included in this static package. Some matching channels
have direct alternatives. YouTube embedding may be restricted by its provider.

The public Malaysia TV list is refreshed from:
https://raw.githubusercontent.com/iptv-org/iptv/master/streams/my.m3u
Bundled TV entries remain present through refreshes. Playlist data from iptv-org
is distributed under CC0. Listed does not establish permission or availability.

Import adds or merges TV playlists. Export M3U omits provider resolver pages and
web-player embeds. Favorites and imported lists stay in this browser. Player
libraries are downloaded when needed and live video comes from its providers.

Use Check video (10s) after a direct stream starts. The check requires advancing
video with picture dimensions; it does not establish long-term reliability or
audible sound. Embedded players require manual picture and sound confirmation.

All 24 parser/player/probe checks passed locally. Live playback and browser CORS
were not verified because network access is restricted in this environment.
