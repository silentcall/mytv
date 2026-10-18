(function (root) {
  'use strict';
  function sample(video, now = Date.now()) {
    let frames = null;
    try {
      const quality = video.getVideoPlaybackQuality?.();
      if (quality && Number.isFinite(quality.totalVideoFrames)) frames = Math.max(0, quality.totalVideoFrames - (quality.droppedVideoFrames || 0));
      else if (Number.isFinite(video.webkitDecodedFrameCount)) frames = Math.max(0, video.webkitDecodedFrameCount - (video.webkitDroppedFrameCount || 0));
    } catch { /* Some browsers do not expose frame counters. */ }
    return { now, time: Number(video.currentTime) || 0, width: video.videoWidth || 0, height: video.videoHeight || 0, ready: video.readyState >= 2, playing: !video.paused && !video.seeking && !video.ended, frames };
  }
  function createProbe(first) {
    let last = first;
    let frameStart = first.frames;
    let seconds = 0;
    return {
      update(next) {
        const wall = Math.max(0, (next.now - last.now) / 1000);
        const advanced = next.time - last.time;
        const valid = next.playing && last.playing && next.ready && last.ready && advanced > 0 && advanced <= wall * 2 + 0.5;
        if (valid) seconds += Math.min(wall, advanced);
        else if (advanced < -0.1 || advanced > wall * 2 + 0.5) { seconds = 0; frameStart = next.frames; }
        const frames = next.frames !== null && frameStart !== null ? Math.max(0, next.frames - frameStart) : null;
        const videoPresent = next.width > 0 && next.height > 0;
        const passed = seconds >= 10 && videoPresent && (frames === null || frames >= 5);
        const timedOut = next.now - first.now >= 20000;
        last = next;
        return { status: passed ? 'passed' : timedOut ? 'failed' : 'checking', seconds: Math.min(10, seconds), frames, width: next.width, height: next.height };
      }
    };
  }
  const api = { sample, createProbe };
  root.TVPlaybackCheck = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
