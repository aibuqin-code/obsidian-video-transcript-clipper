export function normalizeSubtitleResourceUrl(value, baseOrigin = "https://www.bilibili.com") {
  const url = String(value || "").trim().replace(/\\u002F/gi, "/");
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${baseOrigin}${url}`;
  return url;
}

export function isSubtitleResourceUrl(value) {
  const url = normalizeSubtitleResourceUrl(value);
  return /https?:\/\/aisubtitle\.hdslb\.com\/bfs\/(?:ai_subtitle|subtitle)\//i.test(url)
    || /\/bfs\/(?:ai_subtitle|subtitle)\//i.test(url);
}

export function subtitleEntriesFromJson(data) {
  const body = Array.isArray(data?.body)
    ? data.body
    : Array.isArray(data)
      ? data
      : [];

  return body
    .map(item => ({
      start: Number(item?.from),
      end: Number(item?.to),
      text: String(item?.content ?? "")
        .normalize("NFKC")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim()
    }))
    .filter(item => item.text)
    .map(item => ({
      ...item,
      start: Number.isFinite(item.start) ? item.start : null,
      end: Number.isFinite(item.end) ? item.end : null
    }));
}

export function extractSubtitleUrls(value) {
  const found = [];
  const visited = new Set();

  function walk(item, key = "") {
    if (item === null || item === undefined) return;

    if (typeof item === "string") {
      const normalized = normalizeSubtitleResourceUrl(item);
      if (isSubtitleResourceUrl(normalized)) found.push(normalized);
      return;
    }

    if (typeof item !== "object" || visited.has(item)) return;
    visited.add(item);

    if (Array.isArray(item)) {
      item.forEach(child => walk(child, key));
      return;
    }

    for (const [childKey, child] of Object.entries(item)) {
      if (/subtitle_?url|subtitle|url/i.test(childKey) || typeof child === "object") {
        walk(child, childKey);
      }
    }
  }

  walk(value);
  return [...new Set(found)];
}

export function buildSubtitleViewUrl({ aid, cid }) {
  const params = new URLSearchParams({
    oid: String(cid),
    pid: String(aid),
    context_ext: JSON.stringify({ video_type: 1 }),
    type: "1",
    cur_production_type: "0",
    playlist_switch: "0"
  });
  return `https://api.bilibili.com/x/v2/subtitle/web/view?${params.toString()}`;
}

export function parseBvid(url) {
  return String(url || "").match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1] || "";
}
