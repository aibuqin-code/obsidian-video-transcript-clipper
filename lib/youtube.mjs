function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function trackName(track) {
  return normalize(
    track?.name?.simpleText
    || (Array.isArray(track?.name?.runs)
      ? track.name.runs.map(run => run?.text || "").join("")
      : "")
    || track?.languageCode
    || ""
  );
}

export function youtubeLanguageFamily(value) {
  const language = normalize(value).toLowerCase();
  if (/^(zh|cmn|yue)(?:-|$)|中文|汉语|普通话/.test(language)) return "zh";
  if (/^en(?:-|$)|english|英语/.test(language)) return "en";
  return language.split("-")[0] || "unknown";
}

export function youtubeVideoId(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || "";
    if (url.pathname.startsWith("/shorts/")) return url.pathname.split("/")[2] || "";
    return url.searchParams.get("v") || "";
  } catch {
    return "";
  }
}

export function captionTracksFromPlayerResponse(value) {
  const tracks = value?.captions
    ?.playerCaptionsTracklistRenderer
    ?.captionTracks;
  return Array.isArray(tracks) ? tracks : [];
}

export function captionTrackDescriptorsFromPlayerResponse(value) {
  const renderer = value?.captions?.playerCaptionsTracklistRenderer;
  const tracks = Array.isArray(renderer?.captionTracks)
    ? renderer.captionTracks
    : [];
  const defaultAudioIndex = Number.isInteger(renderer?.defaultAudioTrackIndex)
    ? renderer.defaultAudioTrackIndex
    : (renderer?.audioTracks || []).findIndex(track => track?.hasDefaultTrack);
  const defaultAudio = (renderer?.audioTracks || [])[
    defaultAudioIndex >= 0 ? defaultAudioIndex : 0
  ];
  const defaultCaptionIndex = Number(defaultAudio?.defaultCaptionTrackIndex);

  return tracks.map((track, index) => ({
    ...track,
    family: youtubeLanguageFamily(`${track?.languageCode || ""} ${trackName(track)}`),
    kind: track?.kind === "asr" || /自动生成|auto-generated/i.test(trackName(track))
      ? "auto"
      : "manual",
    isDefaultCaption: Number.isInteger(defaultCaptionIndex)
      && index === defaultCaptionIndex
  }));
}

export function sourceCaptionTrack(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  return tracks.find(track => track?.isDefaultCaption)
    || tracks.find(track => track?.kind === "auto")
    || tracks[0];
}

export function chooseCaptionTrack(tracks, preferredLanguages = ["zh-CN", "zh-Hans", "zh", "en"]) {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;

  for (const language of preferredLanguages) {
    const exact = tracks.find(track => normalize(track?.languageCode).toLowerCase()
      === language.toLowerCase());
    if (exact) return exact;
  }

  return tracks.find(track => !track?.kind)
    || tracks.find(track => track?.kind !== "asr")
    || tracks[0];
}

export function entriesFromYoutubeJson3(data) {
  const events = Array.isArray(data?.events) ? data.events : [];
  return events
    .map(event => {
      const text = normalize(
        (Array.isArray(event?.segs) ? event.segs : [])
          .map(segment => segment?.utf8 || "")
          .join("")
          .replace(/\n+/g, " ")
      );
      const start = Number(event?.tStartMs);
      const duration = Number(event?.dDurationMs);
      return {
        start: Number.isFinite(start) ? start / 1000 : null,
        end: Number.isFinite(start) && Number.isFinite(duration)
          ? (start + duration) / 1000
          : null,
        text
      };
    })
    .filter(entry => entry.text);
}
