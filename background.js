import {
  buildSubtitleViewUrl,
  extractSubtitleUrls,
  isSubtitleResourceUrl,
  parseBvid,
  subtitleEntriesFromJson
} from "./lib/bilibili.mjs";
import {
  entriesFromYoutubeJson3,
  youtubeLanguageFamily
} from "./lib/youtube.mjs";
import { inferSubtitleLanguage } from "./lib/transcript.mjs";

const latestSubtitleUrlByTab = new Map();
const latestYoutubeSubtitleUrlByTab = new Map();

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  latestSubtitleUrlByTab.delete(tabId);
  latestYoutubeSubtitleUrlByTab.delete(tabId);
});

chrome.tabs.onRemoved.addListener(tabId => {
  latestSubtitleUrlByTab.delete(tabId);
  latestYoutubeSubtitleUrlByTab.delete(tabId);
});

chrome.webRequest.onBeforeRequest.addListener(
  details => {
    if (details.tabId >= 0 && isSubtitleResourceUrl(details.url)) {
      latestSubtitleUrlByTab.set(details.tabId, details.url);
    }
  },
  { urls: ["https://aisubtitle.hdslb.com/bfs/*"] }
);

function isYoutubeTimedTextUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return /(^|\.)youtube\.com$/i.test(url.hostname)
      && url.pathname === "/api/timedtext";
  } catch {
    return false;
  }
}

chrome.webRequest.onBeforeRequest.addListener(
  details => {
    if (details.tabId >= 0 && isYoutubeTimedTextUrl(details.url)) {
      latestYoutubeSubtitleUrlByTab.set(details.tabId, details.url);
    }
  },
  { urls: ["https://www.youtube.com/api/timedtext*"] }
);

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: options.credentials ?? "include",
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchEntries(url) {
  const data = await fetchJson(url, { credentials: "omit" });
  const entries = subtitleEntriesFromJson(data);
  if (!entries.length) throw new Error("字幕资源正文为空");
  return entries;
}

async function resolveVideoIdentity(bvid) {
  const data = await fetchJson(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`
  );
  const aid = Number(data?.data?.aid);
  const cid = Number(data?.data?.cid || data?.data?.pages?.[0]?.cid);
  if (!Number.isFinite(aid) || !Number.isFinite(cid)) {
    throw new Error("无法解析视频 aid/cid");
  }
  return { aid, cid };
}

async function descriptorUrls(bvid) {
  const { aid, cid } = await resolveVideoIdentity(bvid);
  const endpoints = [
    buildSubtitleViewUrl({ aid, cid }),
    `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${cid}`,
    `https://api.bilibili.com/x/player/wbi/v2?bvid=${encodeURIComponent(bvid)}&cid=${cid}`
  ];

  const urls = [];
  for (const endpoint of endpoints) {
    try {
      urls.push(...extractSubtitleUrls(await fetchJson(endpoint)));
    } catch {
      // 新旧播放器接口并不保证同时可用，继续尝试下一条。
    }
  }
  return [...new Set(urls)];
}

async function extractSubtitle({
  tabId,
  pageUrl,
  observedUrls = [],
  subtitleMode = "smart"
}) {
  const bvid = parseBvid(pageUrl);
  if (!bvid) throw new Error("当前页面没有可识别的 BV 号");

  const candidates = [
    ...observedUrls,
    latestSubtitleUrlByTab.get(tabId),
    ...await descriptorUrls(bvid)
  ].filter(isSubtitleResourceUrl);

  let lastError = null;
  let mismatchedLanguage = "";
  const requestedFamily = subtitleMode === "en"
    ? "en"
    : subtitleMode === "follow-player"
      ? ""
      : "zh";
  for (const url of [...new Set(candidates)].reverse()) {
    try {
      const entries = await fetchEntries(url);
      const inferredLanguage = inferSubtitleLanguage(entries);
      if (requestedFamily && inferredLanguage !== requestedFamily) {
        mismatchedLanguage = inferredLanguage;
        continue;
      }
      latestSubtitleUrlByTab.set(tabId, url);
      return {
        ok: true,
        subtitleSource: "bilibili-ai-subtitle",
        primaryLanguage: inferredLanguage,
        entries
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    ok: false,
    reason: mismatchedLanguage
      ? "requested-language-unavailable"
      : "no-subtitle-track",
    error: mismatchedLanguage
      ? `发现的无标记字幕正文语言为 ${mismatchedLanguage}，与请求语言不符，已拒绝误标。`
      : lastError
      ? `发现字幕轨道，但读取失败：${lastError.message}`
      : "没有发现可读取的 B 站字幕轨道。"
  };
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function youtubeEntriesFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  try {
    const entries = entriesFromYoutubeJson3(JSON.parse(raw));
    if (entries.length) return entries;
  } catch {
    // 继续尝试 XML。
  }

  return [...raw.matchAll(
    /<text\b[^>]*\bstart="([^"]+)"[^>]*(?:\bdur="([^"]+)")?[^>]*>([\s\S]*?)<\/text>/gi
  )].map(match => {
    const start = Number(match[1]);
    const duration = Number(match[2]);
    return {
      start: Number.isFinite(start) ? start : null,
      end: Number.isFinite(start) && Number.isFinite(duration)
        ? start + duration
        : null,
      text: decodeEntities(match[3].replace(/<[^>]+>/g, "")).trim()
    };
  }).filter(entry => entry.text);
}

async function fetchYoutubeEntries(url) {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json,text/xml,text/vtt,*/*"
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (!text.trim()) throw new Error("字幕资源正文为空");
  const entries = youtubeEntriesFromText(text);
  if (!entries.length) throw new Error("字幕资源格式无法识别");
  return entries;
}

function youtubeLanguageFromUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.searchParams.get("tlang")
      || url.searchParams.get("lang")
      || "";
  } catch {
    return "";
  }
}

async function extractYoutubeSubtitle({
  tabId,
  observedUrls = [],
  subtitleMode = "smart",
  requestedFamily = ""
}) {
  const latest = latestYoutubeSubtitleUrlByTab.get(tabId);
  const candidates = [
    latest,
    ...observedUrls
  ].filter(isYoutubeTimedTextUrl);

  let lastError = null;
  let mismatchedLanguage = "";
  const requiredFamily = requestedFamily
    || (subtitleMode === "zh"
      ? "zh"
      : ["en", "bilingual"].includes(subtitleMode)
        ? "en"
        : "");
  for (const url of [...new Set(candidates)]) {
    try {
      const entries = await fetchYoutubeEntries(url);
      const declaredLanguage = youtubeLanguageFromUrl(url);
      const inferredLanguage = inferSubtitleLanguage(entries);
      const detectedLanguage = declaredLanguage || inferredLanguage;
      const detectedFamily = declaredLanguage
        ? youtubeLanguageFamily(declaredLanguage)
        : inferredLanguage;
      if (requiredFamily && detectedFamily !== requiredFamily) {
        mismatchedLanguage = detectedLanguage;
        continue;
      }
      latestYoutubeSubtitleUrlByTab.set(tabId, url);
      return {
        ok: true,
        subtitleSource: "youtube-timedtext",
        primaryLanguage: detectedLanguage,
        entries
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    ok: false,
    reason: mismatchedLanguage
      ? "requested-language-unavailable"
      : "no-subtitle-track",
    error: mismatchedLanguage
      ? `YouTube 后台只观察到 ${mismatchedLanguage} 字幕，与请求语言不符，已拒绝替换原语言。`
      : lastError
      ? `YouTube 已加载字幕轨道，但后台读取失败：${lastError.message}`
      : "尚未观察到 YouTube 播放器成功加载的字幕轨道。"
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const task = message?.type === "EXTRACT_BILIBILI_SUBTITLE"
    ? extractSubtitle
    : message?.type === "EXTRACT_YOUTUBE_SUBTITLE"
      ? extractYoutubeSubtitle
      : null;
  if (!task) return undefined;

  task(message.payload || {})
    .then(sendResponse)
    .catch(error => sendResponse({
      ok: false,
      error: `后台字幕提取失败：${error?.message || String(error)}`
    }));
  return true;
});
