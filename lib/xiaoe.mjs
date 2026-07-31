function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

function parseClock(value) {
  if (Number.isFinite(Number(value))) {
    const number = Number(value);
    return number > 100000 ? number / 1000 : number;
  }

  const match = String(value || "").trim()
    .match(/(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/);
  if (!match) return null;
  const [, hours = "0", minutes, seconds, milliseconds = "0"] = match;
  return Number(hours) * 3600
    + Number(minutes) * 60
    + Number(seconds)
    + Number(milliseconds.padEnd(3, "0")) / 1000;
}

export function xiaoeResourceId(value) {
  const text = String(value || "");
  try {
    const url = new URL(text);
    const pathMatch = url.pathname.match(/\/(?:alive|video|audio)\/([^/?#]+)/i);
    return pathMatch?.[1]
      || url.searchParams.get("alive_id")
      || url.searchParams.get("resource_id")
      || "";
  } catch {
    return "";
  }
}

export function parseTimedText(text) {
  const blocks = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean);

  const output = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex(line => line.includes("-->"));
    if (timingIndex < 0) continue;
    const [from, to] = lines[timingIndex].split("-->").map(item => item.trim());
    const cueText = normalize(lines.slice(timingIndex + 1)
      .join(" ")
      .replace(/<[^>]+>/g, ""));
    if (!cueText) continue;
    output.push({
      start: parseClock(from),
      end: parseClock(to),
      text: cueText
    });
  }
  return output;
}

export function inlineEntriesFromXiaoePayload(payload) {
  const output = [];
  const visited = new Set();
  const textKeys = ["text", "content", "caption", "subtitle", "sentence", "words"];
  const startKeys = ["start", "from", "begin", "start_time", "startTime", "begin_time"];
  const endKeys = ["end", "to", "finish", "end_time", "endTime"];

  function walk(value) {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    const textKey = textKeys.find(key => typeof value[key] === "string");
    const startKey = startKeys.find(key => value[key] !== undefined);
    if (textKey && startKey) {
      const endKey = endKeys.find(key => value[key] !== undefined);
      const text = normalize(value[textKey]);
      if (text) {
        output.push({
          start: parseClock(value[startKey]),
          end: endKey ? parseClock(value[endKey]) : null,
          text
        });
      }
    }

    Object.values(value).forEach(walk);
  }

  walk(payload);
  return output;
}

export function subtitleUrlsFromXiaoePayload(payload) {
  const output = [];
  const visited = new Set();

  function walk(value, key = "") {
    if (typeof value === "string") {
      const candidate = value.trim().replace(/^\/\//, "https://");
      if (
        /subtitle|caption/i.test(key)
        || /\.(?:vtt|srt|json)(?:[?#]|$)/i.test(candidate)
      ) {
        try {
          const url = new URL(candidate);
          if (url.protocol === "https:") output.push(url.href);
        } catch {
          // 相对地址必须由页面适配器基于当前源补全。
        }
      }
      return;
    }

    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach(item => walk(item, key));
      return;
    }
    Object.entries(value).forEach(([childKey, child]) => walk(child, childKey));
  }

  walk(payload);
  return [...new Set(output)];
}
