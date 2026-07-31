(async function extractBilibiliTranscript() {
  const options = {
    subtitleMode: "smart",
    autoEnableSubtitles: true,
    ...(window.__OBSIDIAN_VIDEO_CLIPPER_OPTIONS__ || {})
  };
  const normalize = value => String(value ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

  function inferEntryLanguage(entries) {
    const sample = (entries || [])
      .slice(0, 120)
      .map(entry => normalize(entry?.text))
      .join(" ")
      .slice(0, 8000)
      .toLowerCase();
    const kanaCount = (sample.match(/[\u3040-\u30ff]/g) || []).length;
    if (kanaCount >= 2) return "ja";
    const hangulCount = (sample.match(/[\uac00-\ud7af]/g) || []).length;
    if (hangulCount >= 2) return "ko";
    const hanCount = (sample.match(/[\u3400-\u9fff]/g) || []).length;
    const latinWords = sample.match(/[a-z]+(?:'[a-z]+)?/g) || [];
    if (hanCount >= 4 && hanCount >= latinWords.join("").length * 0.08) {
      return "zh";
    }
    if (latinWords.length >= 4) {
      const englishMarkers = new Set([
        "a", "an", "and", "are", "as", "at", "be", "but", "by", "can",
        "do", "for", "from", "have", "he", "her", "his", "i", "if", "in",
        "is", "it", "me", "my", "not", "of", "on", "or", "our", "she",
        "so", "that", "the", "their", "they", "this", "to", "was", "we",
        "what", "when", "who", "will", "with", "you", "your"
      ]);
      const markerCount = latinWords.filter(word => englishMarkers.has(word)).length;
      return markerCount / latinWords.length >= 0.12 ? "en" : "unknown-latin";
    }
    return "unknown";
  }

  async function metadata() {
    const match = location.href.match(/(BV[0-9A-Za-z]+)/i);
    const videoId = match ? match[1] : "";
    let nativeVideo = window.__INITIAL_STATE__?.videoData || null;
    let nativeSource = nativeVideo ? "bilibili-initial-state" : "";

    if (!nativeVideo && videoId) {
      try {
        const response = await fetch(
          `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(videoId)}`,
          { credentials: "include", cache: "no-store" }
        );
        const payload = await response.json();
        if (payload?.code === 0 && payload?.data) {
          nativeVideo = payload.data;
          nativeSource = "bilibili-view-api";
        }
      } catch {
        // 平台详情接口不可用时才回退网页 Meta。
      }
    }

    const title = (document.querySelector("h1.video-title")?.textContent
      || nativeVideo?.title
      || document.querySelector('meta[property="og:title"]')?.content
      || document.title
      || "B站视频")
      .replace(/_哔哩哔哩_bilibili$/i, "")
      .trim();

    const author = nativeVideo?.owner?.name
      || document.querySelector(".up-name")?.textContent
      || document.querySelector(".upinfo-detail__top .name")?.textContent
      || document.querySelector('meta[name="author"]')?.content
      || "";

    const nativeDescription = nativeVideo?.desc || "";
    const description = nativeDescription
      || document.querySelector('meta[property="og:description"]')?.content
      || document.querySelector('meta[name="description"]')?.content
      || "";

    const video = document.querySelector("video");

    return {
      platform: "bilibili",
      title: normalize(title),
      author: normalize(author),
      description: normalize(description),
      descriptionSource: nativeDescription ? nativeSource : "page-meta-fallback",
      descriptionQuality: nativeDescription ? "platform-native" : "fallback",
      url: location.href,
      videoId,
      duration: Number.isFinite(video?.duration)
        ? video.duration
        : Number(nativeVideo?.duration) || null
    };
  }

  function observedSubtitleUrls() {
    try {
      return [...new Set(
        (performance.getEntriesByType("resource") || [])
          .map(entry => entry?.name)
          .filter(isSubtitleResourceUrl)
      )];
    } catch {
      return [];
    }
  }

  function isSubtitleResourceUrl(url) {
    return typeof url === "string" && (
      /aisubtitle/i.test(url)
      || /\/bfs\/(?:ai_subtitle|subtitle)\//i.test(url)
      || /subtitle_url=/i.test(url)
    );
  }

  const subtitleResourceUrls = observedSubtitleUrls;

  async function fetchSubtitleResource(url) {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`字幕接口返回 ${response.status}`);
    const data = await response.json();
    const body = Array.isArray(data?.body) ? data.body : Array.isArray(data) ? data : [];
    const entries = body
      .map(item => ({
        start: Number(item?.from),
        end: Number(item?.to),
        text: normalize(item?.content)
      }))
      .filter(item => item.text);

    return entries.length ? entries : null;
  }

  async function tryExistingSubtitleResource(requiredFamily = "") {
    const urls = subtitleResourceUrls();
    for (let index = urls.length - 1; index >= 0; index -= 1) {
      try {
        const entries = await fetchSubtitleResource(urls[index]);
        if (
          entries
          && (!requiredFamily || inferEntryLanguage(entries) === requiredFamily)
        ) {
          return entries;
        }
      } catch {
        // 继续尝试更早的字幕资源。
      }
    }
    return null;
  }

  function normalizeSubtitleUrl(value) {
    const url = String(value || "").trim();
    if (!url) return "";
    if (url.startsWith("//")) return `https:${url}`;
    if (url.startsWith("/")) return `${location.origin}${url}`;
    return url;
  }

  function subtitlesFromPlayerPayload(data) {
    const subtitles = data?.data?.subtitle?.subtitles
      || data?.subtitle?.subtitles
      || [];
    return Array.isArray(subtitles) ? subtitles : [];
  }

  function descriptorLanguage(descriptor) {
    return normalize(
      descriptor?.lan
      || descriptor?.languageCode
      || descriptor?.lan_doc
      || ""
    );
  }

  function descriptorLabel(descriptor) {
    return normalize(
      descriptor?.lan_doc
      || descriptor?.name
      || descriptorLanguage(descriptor)
      || "未命名字幕"
    );
  }

  function languageFamily(value) {
    const language = normalize(value).toLowerCase();
    if (/^(ai-)?zh|中文|汉语/.test(language)) return "zh";
    if (/^en(?:-|$)|english|英语/.test(language)) return "en";
    return language.split("-")[0] || "unknown";
  }

  function orderedDescriptors(descriptors) {
    const mode = options.subtitleMode;
    const preferred = mode === "en"
      ? ["en", "zh"]
      : ["zh", "en"];
    return [...descriptors].sort((left, right) => {
      const score = item => {
        const family = languageFamily(
          `${descriptorLanguage(item)} ${descriptorLabel(item)}`
        );
        const index = preferred.indexOf(family);
        const languageScore = index < 0 ? 0 : (preferred.length - index) * 100;
        const manualScore = /^ai-|自动|auto/i.test(
          `${descriptorLanguage(item)} ${descriptorLabel(item)}`
        ) ? 0 : 10;
        return languageScore + manualScore;
      };
      return score(right) - score(left);
    });
  }

  function availableTracks(descriptors) {
    return descriptors.map(descriptor => ({
      languageCode: descriptorLanguage(descriptor),
      label: descriptorLabel(descriptor),
      kind: /^ai-|自动|auto/i.test(
        `${descriptorLanguage(descriptor)} ${descriptorLabel(descriptor)}`
      ) ? "auto" : "manual"
    }));
  }

  async function fetchSubtitleDescriptor(descriptor) {
    const url = normalizeSubtitleUrl(
      descriptor?.subtitle_url
      || descriptor?.subtitleUrl
      || descriptor?.url
    );
    if (!url) return null;
    return fetchSubtitleResource(url);
  }

  async function trySubtitleDescriptors(descriptors) {
    const requestedFamily = options.subtitleMode === "en"
      ? "en"
      : options.subtitleMode === "follow-player"
        ? ""
        : "zh";
    const eligible = requestedFamily
      ? descriptors.filter(descriptor => languageFamily(
        `${descriptorLanguage(descriptor)} ${descriptorLabel(descriptor)}`
      ) === requestedFamily)
      : descriptors;
    const sorted = orderedDescriptors(eligible);

    for (const descriptor of sorted) {
      try {
        const entries = await fetchSubtitleDescriptor(descriptor);
        if (entries) return {
          entries,
          descriptor,
          availableTracks: availableTracks(descriptors)
        };
      } catch {
        // 继续尝试下一条字幕轨道。
      }
    }
    return null;
  }

  async function tryPlayerStateSubtitles() {
    const candidates = [
      window.__playinfo__,
      window.__INITIAL_STATE__?.playinfo,
      window.__INITIAL_STATE__?.videoData
    ];

    for (const candidate of candidates) {
      const descriptors = subtitlesFromPlayerPayload(candidate);
      if (!descriptors.length) continue;
      const result = await trySubtitleDescriptors(descriptors);
      if (result) return result;
    }
    return null;
  }

  async function resolveCid(videoId) {
    const stateCid = Number(
      window.__INITIAL_STATE__?.videoData?.cid
      || window.__playinfo__?.data?.cid
    );
    if (Number.isFinite(stateCid) && stateCid > 0) return stateCid;

    try {
      const response = await fetch(
        `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(videoId)}`,
        { credentials: "include" }
      );
      const data = await response.json();
      const cid = Number(data?.data?.cid);
      return Number.isFinite(cid) && cid > 0 ? cid : null;
    } catch {
      return null;
    }
  }

  async function tryPlayerApiSubtitles(videoId) {
    if (!videoId) return null;
    const cid = await resolveCid(videoId);
    if (!cid) return null;

    const endpoints = [
      `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(videoId)}&cid=${cid}`,
      `https://api.bilibili.com/x/player/wbi/v2?bvid=${encodeURIComponent(videoId)}&cid=${cid}`
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, { credentials: "include" });
        if (!response.ok) continue;
        const data = await response.json();
        const descriptors = subtitlesFromPlayerPayload(data);
        if (!descriptors.length) continue;
        const result = await trySubtitleDescriptors(descriptors);
        if (result) return result;
      } catch {
        // 某个接口不可用时继续走页面轨道和网络捕获。
      }
    }
    return null;
  }

  async function captureSubtitleRequest(requiredFamily = "", timeoutMs = 1500) {
    const existing = await tryExistingSubtitleResource(requiredFamily);
    if (existing) return existing;

    const originalFetch = window.fetch;
    const originalOpen = window.XMLHttpRequest.prototype.open;
    const originalSend = window.XMLHttpRequest.prototype.send;
    let settled = false;

    return new Promise(async resolve => {
      const finish = entries => {
        if (settled) return;
        settled = true;
        window.fetch = originalFetch;
        window.XMLHttpRequest.prototype.open = originalOpen;
        window.XMLHttpRequest.prototype.send = originalSend;
        resolve(entries || null);
      };

      const isSubtitleUrl = value => {
        const url = typeof value === "string" ? value : value?.url;
        return isSubtitleResourceUrl(url);
      };

      window.fetch = function (...args) {
        const request = originalFetch.apply(this, args);
        if (isSubtitleUrl(args[0])) {
          request.then(response => response.clone().json())
            .then(data => {
              const body = Array.isArray(data?.body) ? data.body : [];
              const entries = body.map(item => ({
                start: Number(item?.from),
                end: Number(item?.to),
                text: normalize(item?.content)
              })).filter(item => item.text);
              if (
                entries.length
                && (!requiredFamily || inferEntryLanguage(entries) === requiredFamily)
              ) {
                finish(entries);
              }
            })
            .catch(() => {});
        }
        return request;
      };

      window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__obsidianClipperSubtitleUrl = url;
        return originalOpen.call(this, method, url, ...rest);
      };

      window.XMLHttpRequest.prototype.send = function (...args) {
        if (isSubtitleUrl(this.__obsidianClipperSubtitleUrl)) {
          this.addEventListener("load", () => {
            try {
              const data = JSON.parse(this.responseText);
              const body = Array.isArray(data?.body) ? data.body : [];
              const entries = body.map(item => ({
                start: Number(item?.from),
                end: Number(item?.to),
                text: normalize(item?.content)
              })).filter(item => item.text);
              if (
                entries.length
                && (!requiredFamily || inferEntryLanguage(entries) === requiredFamily)
              ) {
                finish(entries);
              }
            } catch {
              // 等待 Performance 兜底。
            }
          }, { once: true });
        }
        return originalSend.apply(this, args);
      };

      setTimeout(async () => {
        if (settled) return;
        const fallback = await tryExistingSubtitleResource(requiredFamily);
        finish(fallback);
      }, timeoutMs);
    });
  }

  if (!location.hostname.endsWith("bilibili.com") || !location.pathname.includes("/video/")) {
    return { ok: false, error: "当前页面不是 B 站视频页。" };
  }

  try {
    const pageMetadata = await metadata();
    const observedUrls = observedSubtitleUrls();
    let playerSubtitleActivated = false;

    // 把页面已经请求过的临时签名字幕地址交给扩展后台。
    // popup 会优先让后台读取；这里仍保留页面内回退，避免后台休眠或接口变化。
    pageMetadata.observedSubtitleUrls = observedUrls;
    const playerStateResult = await tryPlayerStateSubtitles();
    if (playerStateResult?.entries?.length) {
      return {
        ok: true,
        ...pageMetadata,
        subtitleSource: "bilibili-player-state",
        primaryLanguage: languageFamily(
          `${descriptorLanguage(playerStateResult.descriptor)} ${descriptorLabel(playerStateResult.descriptor)}`
        ),
        selectedTrack: descriptorLabel(playerStateResult.descriptor),
        availableTracks: playerStateResult.availableTracks,
        playerSubtitleActivated,
        entries: playerStateResult.entries
      };
    }

    const playerApiResult = await tryPlayerApiSubtitles(pageMetadata.videoId);
    if (playerApiResult?.entries?.length) {
      return {
        ok: true,
        ...pageMetadata,
        subtitleSource: "bilibili-player-api",
        primaryLanguage: languageFamily(
          `${descriptorLanguage(playerApiResult.descriptor)} ${descriptorLabel(playerApiResult.descriptor)}`
        ),
        selectedTrack: descriptorLabel(playerApiResult.descriptor),
        availableTracks: playerApiResult.availableTracks,
        playerSubtitleActivated,
        entries: playerApiResult.entries
      };
    }

    if (options.subtitleMode === "en") {
      return {
        ok: false,
        ...pageMetadata,
        reason: "requested-language-unavailable",
        error: "这个 B站视频没有 English 字幕轨道。请选择“智能”或“中文”，也可以先在播放器里确认是否存在英文字幕。"
      };
    }

    const requestedFamily = options.subtitleMode === "en"
      ? "en"
      : options.subtitleMode === "follow-player"
        ? ""
        : "zh";
    const entries = await captureSubtitleRequest(requestedFamily);
    if (entries?.length) {
      const inferredLanguage = inferEntryLanguage(entries);
      if (requestedFamily && inferredLanguage !== requestedFamily) {
        return {
          ok: false,
          ...pageMetadata,
          reason: "requested-language-unavailable",
          detectedLanguage: inferredLanguage,
          error: requestedFamily === "zh"
            ? "找到了一个没有语言标记的字幕资源，但正文不是中文，已拒绝把它冒充成中文字幕。请在播放器里确认是否真的有中文轨道。"
            : "找到了一个没有语言标记的字幕资源，但正文不像英文，已拒绝把它冒充成 English 字幕。"
        };
      }
      playerSubtitleActivated = options.autoEnableSubtitles;
      return {
        ok: true,
        ...pageMetadata,
        subtitleSource: "bilibili-ai-subtitle",
        primaryLanguage: inferredLanguage,
        playerSubtitleActivated,
        entries
      };
    }

    const subtitleMenuText = normalize(
      document.querySelector(".bpx-player-ctrl-subtitle")?.textContent
    );
    const pageSaysNoSubtitle = subtitleMenuText.includes("暂无字幕");

    return {
      ok: false,
      ...pageMetadata,
      reason: "no-subtitle-track",
      pageSaysNoSubtitle,
      error: pageSaysNoSubtitle
        ? "这个视频没有 B 站可读取的字幕轨道。画面中的文字可能是压进视频画面的硬字幕；当前版本不会启动音频转写。"
        : "没有取得可读取的字幕轨道。请确认已经登录，并检查播放器的「字幕」菜单是否真的提供语言轨道；当前版本不会把视频下载后转写。"
    };
  } catch (error) {
    return {
      ok: false,
      error: `字幕提取失败：${error?.message || String(error)}`
    };
  }
})();
