(async function extractXiaoeTranscript() {
  const normalize = value => String(value ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();

  const isXiaoeHost = hostname => [
    "xiaoe-tech.com",
    "xiaoeknow.com",
    "xiaoecloud.com",
    "xet.pomoho.com",
    "xet.tech",
    "xet-pc.citv.cn"
  ].some(domain => hostname === domain || hostname.endsWith(`.${domain}`));

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

  function parseTimedText(text) {
    return String(text || "")
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n")
      .split(/\n{2,}/)
      .map(block => block.trim())
      .filter(Boolean)
      .flatMap(block => {
        const lines = block.split("\n");
        const timingIndex = lines.findIndex(line => line.includes("-->"));
        if (timingIndex < 0) return [];
        const [from, to] = lines[timingIndex].split("-->").map(item => item.trim());
        const text = normalize(lines.slice(timingIndex + 1)
          .join(" ")
          .replace(/<[^>]+>/g, ""));
        return text ? [{
          start: parseClock(from),
          end: parseClock(to),
          text
        }] : [];
      });
  }

  function inlineEntries(payload, trustedSubtitlePayload = false) {
    const output = [];
    const visited = new Set();
    const textKeys = ["text", "content", "caption", "subtitle", "sentence", "words"];
    const startKeys = ["start", "from", "begin", "start_time", "startTime", "begin_time"];
    const endKeys = ["end", "to", "finish", "end_time", "endTime"];

    function walk(value, contextHint = trustedSubtitlePayload) {
      if (!value || typeof value !== "object" || visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) {
        value.forEach(item => walk(item, contextHint));
        return;
      }

      const textKey = textKeys.find(key => typeof value[key] === "string");
      const startKey = startKeys.find(key => value[key] !== undefined);
      if (contextHint && textKey && startKey) {
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
      Object.entries(value).forEach(([key, child]) => {
        const childHint = contextHint
          || /subtitle|caption|transcript|sentence|segment|words|speech.*text/i.test(key);
        walk(child, childHint);
      });
    }

    walk(payload);
    return output;
  }

  function subtitleUrls(payload) {
    const output = [];
    const visited = new Set();

    function walk(value, key = "") {
      if (typeof value === "string") {
        let candidate = value.trim();
        if (!candidate) return;
        if (candidate.startsWith("//")) candidate = `https:${candidate}`;
        if (candidate.startsWith("/")) candidate = `${location.origin}${candidate}`;
        if (
          /subtitle|caption/i.test(key)
          || /\.(?:vtt|srt|json)(?:[?#]|$)/i.test(candidate)
        ) {
          try {
            const url = new URL(candidate);
            if (url.protocol === "https:") output.push(url.href);
          } catch {
            // 不是可读取的字幕地址。
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

  function metadata() {
    const rawTitle = document.querySelector('meta[property="og:title"]')?.content
      || document.querySelector("h1")?.textContent
      || document.title
      || "小鹅通课程";
    const title = normalize(rawTitle)
      .replace(/[-_—]\s*小鹅通.*$/i, "")
      .replace(/\.\.\.$/, "");
    const author = normalize(
      document.querySelector('meta[name="author"]')?.content
      || document.querySelector("header")?.textContent
      || document.querySelector("banner")?.textContent
      || ""
    ).slice(0, 80);
    const description = normalize(
      document.querySelector('meta[property="og:description"]')?.content
      || document.querySelector('meta[name="description"]')?.content
      || ""
    );
    const video = document.querySelector("video");
    const resourceId = location.pathname.match(/\/(?:alive|video|audio)\/([^/?#]+)/i)?.[1]
      || new URL(location.href).searchParams.get("alive_id")
      || new URL(location.href).searchParams.get("resource_id")
      || "";
    return {
      platform: "xiaoe",
      title,
      author,
      description,
      descriptionSource: "page-meta-fallback",
      descriptionQuality: "fallback",
      url: location.href,
      videoId: resourceId,
      duration: Number.isFinite(video?.duration) ? video.duration : null
    };
  }

  function observedResources() {
    try {
      return (performance.getEntriesByType("resource") || [])
        .map(entry => String(entry?.name || ""))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function loadedTextTrackEntries() {
    const tracks = Array.from(document.querySelector("video")?.textTracks || []);
    for (const track of tracks) {
      const entries = Array.from(track?.cues || []).map(cue => ({
        start: Number.isFinite(Number(cue?.startTime)) ? Number(cue.startTime) : null,
        end: Number.isFinite(Number(cue?.endTime)) ? Number(cue.endTime) : null,
        text: normalize(cue?.text)
      })).filter(entry => entry.text);
      if (entries.length) return entries;
    }
    return [];
  }

  function pageSubtitlePayloads() {
    const payloads = [
      window.__INITIAL_STATE__,
      window.__NUXT__,
      window.__NEXT_DATA__,
      window.__APOLLO_STATE__
    ].filter(Boolean);

    for (const script of document.querySelectorAll(
      'script[type="application/json"], script#__NEXT_DATA__'
    )) {
      const text = script.textContent?.trim();
      if (!text || text.length > 2_000_000) continue;
      try {
        payloads.push(JSON.parse(text));
      } catch {
        // 页面内并非所有 application/json 都是完整 JSON。
      }
    }
    return payloads;
  }

  function trackElementUrls() {
    return [...document.querySelectorAll("video track, audio track")]
      .map(track => track.getAttribute("src") || "")
      .filter(Boolean)
      .map(value => {
        try {
          return new URL(value, location.href).href;
        } catch {
          return "";
        }
      })
      .filter(Boolean);
  }

  function looksLikeSubtitleEndpoint(value) {
    const url = String(value || "");
    return !/\.(?:m3u8|mp4|m4a|mp3|flv|ts)(?:[?#]|$)/i.test(url)
      && (
        /subtitle|caption|transcript/i.test(url)
        || /(?:speech|voice)[_-]?(?:to[_-]?)?text/i.test(url)
        || /\.(?:vtt|srt|ass)(?:[?#]|$)/i.test(url)
      );
  }

  async function fetchPayload(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`字幕接口返回 ${response.status}`);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 2_000_000) {
      throw new Error("字幕候选响应过大，已停止读取");
    }
    const contentType = response.headers.get("content-type") || "";
    if (/json/i.test(contentType)) return response.json();
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async function entriesFromSubtitleUrl(url) {
    const payload = await fetchPayload(url);
    if (typeof payload === "string" && /WEBVTT|-->/i.test(payload)) {
      return parseTimedText(payload);
    }
    return typeof payload === "string"
      ? []
      : inlineEntries(payload, true);
  }

  async function resolveSubtitleEntries(resources, payloads) {
    const loadedEntries = loadedTextTrackEntries();
    if (loadedEntries.length) {
      return {
        entries: loadedEntries,
        endpointFound: true,
        source: "loaded-text-track",
        failures: []
      };
    }

    for (const payload of payloads) {
      const entries = inlineEntries(payload, false);
      if (entries.length) {
        return {
          entries,
          endpointFound: true,
          source: "inline-page-state",
          failures: []
        };
      }
    }

    const payloadUrls = payloads.flatMap(payload => subtitleUrls(payload));
    const endpoints = [...new Set([
      ...trackElementUrls(),
      ...payloadUrls,
      ...resources.filter(looksLikeSubtitleEndpoint)
    ])].slice(-20);
    const failures = [];

    for (const endpoint of [...endpoints].reverse()) {
      try {
        const payload = await fetchPayload(endpoint);
        const directEntries = typeof payload === "string" && /WEBVTT|-->/i.test(payload)
          ? parseTimedText(payload)
          : inlineEntries(payload, true);
        if (directEntries.length) {
          return {
            entries: directEntries,
            endpointFound: true,
            source: "platform-subtitle-endpoint",
            failures
          };
        }

        for (const url of typeof payload === "string" ? [] : subtitleUrls(payload)) {
          try {
            const entries = await entriesFromSubtitleUrl(url);
            if (entries.length) {
              return {
                entries,
                endpointFound: true,
                source: "platform-subtitle-file",
                failures
              };
            }
          } catch (error) {
            failures.push(error?.message || String(error));
          }
        }
      } catch (error) {
        failures.push(error?.message || String(error));
      }
    }

    return {
      entries: [],
      endpointFound: endpoints.length > 0,
      source: "",
      failures
    };
  }

  if (!isXiaoeHost(location.hostname)) {
    return { ok: false, error: "当前页面不是小鹅通课程页。" };
  }

  try {
    const pageMetadata = metadata();
    const resources = observedResources();
    const payloads = pageSubtitlePayloads();
    const subtitleResult = await resolveSubtitleEntries(resources, payloads);
    const hasPlayableMedia = !!document.querySelector("video, audio");
    const encryptedPlayback = resources.some(url => (
      /encrypt[-_.]/i.test(url)
      || /playlist_eof\.m3u8/i.test(url)
    ));

    if (subtitleResult.entries.length) {
      return {
        ok: true,
        ...pageMetadata,
        subtitleSource: `xiaoe-${subtitleResult.source || "platform-subtitle"}`,
        primaryLanguage: "zh",
        entries: subtitleResult.entries
      };
    }

    return {
      ok: false,
      ...pageMetadata,
      reason: "no-subtitle-track",
      subtitleEndpointFound: subtitleResult.endpointFound,
      hasPlayableMedia,
      encryptedPlayback,
      error: subtitleResult.endpointFound
        ? "小鹅通页面查询了字幕接口，但这节课没有返回可用字幕。"
        : "这节小鹅通课程没有发现平台字幕接口。"
    };
  } catch (error) {
    return {
      ok: false,
      reason: "extract-failed",
      error: `小鹅通字幕核验失败：${error?.message || String(error)}`
    };
  }
})();
