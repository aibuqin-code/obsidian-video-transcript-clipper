(async function extractYoutubeTranscript() {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const options = {
    subtitleMode: "smart",
    autoEnableSubtitles: true,
    ...(window.__OBSIDIAN_VIDEO_CLIPPER_OPTIONS__ || {})
  };
  const normalize = value => String(value ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();

  function metadata() {
    const videoDetails = playerResponses()
      .map(response => response?.videoDetails)
      .find(Boolean);
    const title = normalize(
      videoDetails?.title
      || document.querySelector("h1.ytd-watch-metadata yt-formatted-string")?.textContent
      || document.querySelector('meta[property="og:title"]')?.content
      || document.title.replace(/\s*-\s*YouTube$/i, "")
      || "YouTube 视频"
    );
    const author = normalize(
      videoDetails?.author
      || document.querySelector("#owner ytd-channel-name a")?.textContent
      || document.querySelector('link[itemprop="name"]')?.getAttribute("content")
      || document.querySelector('meta[itemprop="channelId"]')?.content
      || ""
    );
    const nativeDescription = normalize(videoDetails?.shortDescription || "");
    const description = nativeDescription || normalize(
      document.querySelector('meta[property="og:description"]')?.content
      || document.querySelector('meta[name="description"]')?.content
      || ""
    );
    const url = new URL(location.href);
    const videoId = url.pathname.startsWith("/shorts/")
      ? url.pathname.split("/")[2] || ""
      : url.searchParams.get("v") || "";
    const video = document.querySelector("video");
    return {
      platform: "youtube",
      title,
      author,
      description,
      descriptionSource: nativeDescription
        ? "youtube-player-response"
        : "page-meta-fallback",
      descriptionQuality: nativeDescription ? "platform-native" : "fallback",
      url: location.href,
      videoId,
      duration: Number.isFinite(video?.duration)
        ? video.duration
        : Number(videoDetails?.lengthSeconds) || null
    };
  }

  function playerResponses() {
    return [
      window.ytInitialPlayerResponse,
      window.ytplayer?.config?.args?.player_response
    ].flatMap(value => {
      if (typeof value !== "string") return value ? [value] : [];
      try {
        return [JSON.parse(value)];
      } catch {
        return [];
      }
    });
  }

  function rendererFromResponse(response) {
    return response?.captions?.playerCaptionsTracklistRenderer || null;
  }

  function trackName(track) {
    return normalize(
      track?.name?.simpleText
      || (Array.isArray(track?.name?.runs)
        ? track.name.runs.map(run => run?.text || "").join("")
        : "")
      || track?.languageName
      || track?.displayName
      || track?.languageCode
      || "未命名字幕"
    );
  }

  function languageFamily(value) {
    const language = normalize(value).toLowerCase();
    if (/^(zh|cmn|yue)(?:-|$)|中文|汉语|普通话/.test(language)) return "zh";
    if (/^en(?:-|$)|english|英语/.test(language)) return "en";
    return language.split("-")[0] || "unknown";
  }

  function normalizeTrack(track, source = "player-response", extra = {}) {
    return {
      languageCode: normalize(track?.languageCode),
      label: trackName(track),
      family: languageFamily(`${track?.languageCode || ""} ${trackName(track)}`),
      kind: track?.kind === "asr" || /自动生成|auto-generated/i.test(trackName(track))
        ? "auto"
        : "manual",
      baseUrl: String(track?.baseUrl || ""),
      isTranslatable: Boolean(track?.isTranslatable),
      source,
      raw: track,
      ...extra
    };
  }

  function collectTrackData() {
    const tracks = [];
    const translations = [];

    for (const response of playerResponses()) {
      const renderer = rendererFromResponse(response);
      if (!renderer) continue;
      const captionTracks = renderer.captionTracks || [];
      const defaultAudioIndex = Number.isInteger(renderer.defaultAudioTrackIndex)
        ? renderer.defaultAudioTrackIndex
        : (renderer.audioTracks || []).findIndex(track => track?.hasDefaultTrack);
      const defaultAudio = (renderer.audioTracks || [])[
        defaultAudioIndex >= 0 ? defaultAudioIndex : 0
      ];
      const defaultCaptionIndex = Number(defaultAudio?.defaultCaptionTrackIndex);

      for (const [index, track] of captionTracks.entries()) {
        tracks.push(normalizeTrack(track, "player-response", {
          responseIndex: index,
          isDefaultCaption: Number.isInteger(defaultCaptionIndex)
            && index === defaultCaptionIndex
        }));
      }
      for (const language of renderer.translationLanguages || []) {
        translations.push({
          languageCode: normalize(language?.languageCode),
          label: trackName(language),
          family: languageFamily(
            `${language?.languageCode || ""} ${trackName(language)}`
          ),
          raw: language
        });
      }
    }

    const player = document.querySelector("#movie_player");
    try {
      for (const track of player?.getOption?.("captions", "tracklist") || []) {
        tracks.push(normalizeTrack(track, "player-api"));
      }
    } catch {
      // 部分播放器版本未开放 captions 选项，继续使用初始页面数据。
    }

    const dedupe = (items, key) => [...new Map(
      items.map(item => [key(item), item])
    ).values()];
    return {
      tracks: dedupe(
        tracks,
        track => `${track.languageCode}|${track.kind}|${track.baseUrl || track.label}`
      ),
      translations: dedupe(
        translations,
        language => `${language.languageCode}|${language.label}`
      )
    };
  }

  function preferManual(tracks) {
    return [...tracks].sort((left, right) => (
      Number(left.kind === "manual") - Number(right.kind === "manual")
    )).reverse();
  }

  function firstFamily(tracks, family) {
    return preferManual(tracks).find(track => track.family === family) || null;
  }

  function sourceTrack(tracks) {
    const defaultCaption = tracks.find(track => track.isDefaultCaption);
    if (defaultCaption) return defaultCaption;
    const sourceAsr = tracks.find(track => track.kind === "auto");
    if (sourceAsr) return sourceAsr;
    return preferManual(tracks)[0] || null;
  }

  function chineseTranslation(translations) {
    return translations.find(language => (
      /^(zh-hans|zh-cn)$/i.test(language.languageCode)
    )) || translations.find(language => language.family === "zh") || null;
  }

  function englishTranslation(translations) {
    return translations.find(language => language.family === "en") || null;
  }

  function selectPlan(trackData) {
    const { tracks, translations } = trackData;
    const source = sourceTrack(tracks);
    const english = firstFamily(tracks, "en");
    const chinese = firstFamily(tracks, "zh");
    const chineseTarget = chineseTranslation(translations);
    const englishTarget = englishTranslation(translations);

    if (!source) return null;
    if (options.subtitleMode === "follow-player") {
      const player = document.querySelector("#movie_player");
      try {
        const current = player?.getOption?.("captions", "track");
        if (current) {
          return { primary: normalizeTrack(current, "current-player"), secondary: null };
        }
      } catch {
        // 无法读取当前选轨时回落到原语言。
      }
      return { primary: source, secondary: null };
    }

    if (options.subtitleMode === "zh") {
      if (chinese) return { primary: chinese, secondary: null };
      return chineseTarget
        ? { primary: source, primaryTranslation: chineseTarget, secondary: null }
        : { unavailable: "中文" };
    }

    if (options.subtitleMode === "en") {
      if (english) return { primary: english, secondary: null };
      return englishTarget
        ? { primary: source, primaryTranslation: englishTarget, secondary: null }
        : { unavailable: "English" };
    }

    const original = source;
    const wantsBilingual = options.subtitleMode === "bilingual"
      || (options.subtitleMode === "smart" && original.family === "en");
    if (!wantsBilingual || original.family === "zh") {
      return { primary: original, secondary: null };
    }

    if (chinese && chinese !== original) {
      return { primary: original, secondary: chinese };
    }
    if (chineseTarget) {
      return {
        primary: original,
        secondary: original,
        secondaryTranslation: chineseTarget
      };
    }
    if (options.subtitleMode === "bilingual") {
      return { unavailable: "中英双语" };
    }
    return { primary: original, secondary: null };
  }

  function entriesFromJson3(data) {
    return (Array.isArray(data?.events) ? data.events : [])
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

  function parseClock(value) {
    const match = String(value).match(
      /(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/
    );
    if (!match) return null;
    const [, hours = "0", minutes, seconds, milliseconds = "0"] = match;
    return Number(hours) * 3600
      + Number(minutes) * 60
      + Number(seconds)
      + Number(milliseconds.padEnd(3, "0")) / 1000;
  }

  function entriesFromXmlOrVtt(text) {
    const raw = String(text || "").trim();
    if (!raw) return [];
    try {
      const jsonEntries = entriesFromJson3(JSON.parse(raw));
      if (jsonEntries.length) return jsonEntries;
    } catch {
      // 继续解析 VTT/XML。
    }

    if (/^WEBVTT/i.test(raw)) {
      return raw.replace(/\r\n?/g, "\n").split(/\n{2,}/).flatMap(block => {
        const lines = block.trim().split("\n");
        const timingIndex = lines.findIndex(line => line.includes("-->"));
        if (timingIndex < 0) return [];
        const [from, to] = lines[timingIndex].split("-->").map(value => value.trim());
        const cueText = normalize(
          lines.slice(timingIndex + 1).join(" ").replace(/<[^>]+>/g, "")
        );
        return cueText
          ? [{ start: parseClock(from), end: parseClock(to), text: cueText }]
          : [];
      });
    }

    if (/<(?:transcript|text)\b/i.test(raw)) {
      const xml = new DOMParser().parseFromString(raw, "text/xml");
      return [...xml.querySelectorAll("text")].map(node => {
        const start = Number(node.getAttribute("start"));
        const duration = Number(node.getAttribute("dur"));
        return {
          start: Number.isFinite(start) ? start : null,
          end: Number.isFinite(start) && Number.isFinite(duration)
            ? start + duration
            : null,
          text: normalize(node.textContent)
        };
      }).filter(entry => entry.text);
    }
    return [];
  }

  function isTimedTextUrl(value) {
    try {
      const url = new URL(String(value?.url || value || ""), location.href);
      return /(^|\.)youtube\.com$/i.test(url.hostname)
        && url.pathname === "/api/timedtext";
    } catch {
      return false;
    }
  }

  function observedTimedTextUrls() {
    try {
      return [...new Set(
        (performance.getEntriesByType("resource") || [])
          .map(entry => String(entry?.name || ""))
          .filter(isTimedTextUrl)
      )];
    } catch {
      return [];
    }
  }

  function entriesFromLoadedTextTracks() {
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

  function publicTrack(track) {
    return {
      languageCode: track?.languageCode || "",
      label: track?.label || "",
      kind: track?.kind || "",
      family: track?.family || "unknown",
      isDefaultCaption: Boolean(track?.isDefaultCaption)
    };
  }

  async function activateTrack(track, translationLanguage) {
    if (!options.autoEnableSubtitles) return false;
    const player = document.querySelector("#movie_player");
    let activatedByPlayerApi = false;

    try {
      player?.loadModule?.("captions");
      const rawTrack = { ...(track?.raw || {}) };
      if (translationLanguage?.raw) {
        rawTrack.translationLanguage = translationLanguage.raw;
      }
      if (Object.keys(rawTrack).length) {
        player?.setOption?.("captions", "track", {});
        await sleep(80);
        player?.setOption?.("captions", "track", rawTrack);
        player?.setOption?.("captions", "reload", true);
        activatedByPlayerApi = true;
      }
    } catch {
      // 内部播放器 API 变化时继续使用 CC 按钮回退。
    }

    // 不点击可见的 CC/设置菜单：页面点击会让 Chrome 扩展弹窗失焦并中断导出。
    // 内部播放器 API 不可用时，后续仍会直接读取字幕轨；若也失败，再提示手动选择。
    return activatedByPlayerApi;
  }

  async function fetchTrackDirect(track, translationLanguage) {
    const baseUrl = String(track?.baseUrl || "");
    if (!baseUrl) return null;
    const url = new URL(baseUrl, location.href);
    if (translationLanguage?.languageCode) {
      url.searchParams.set("tlang", translationLanguage.languageCode);
    }
    url.searchParams.set("fmt", "json3");
    const response = await fetch(url.href, {
      credentials: "include",
      cache: "no-store"
    });
    if (!response.ok) return null;
    const entries = entriesFromXmlOrVtt(await response.text());
    return entries.length ? entries : null;
  }

  async function captureTrack(track, translationLanguage, timeoutMs = 6500) {
    const originalFetch = window.fetch;
    const originalOpen = window.XMLHttpRequest.prototype.open;
    const originalSend = window.XMLHttpRequest.prototype.send;
    let settled = false;

    return new Promise(async resolve => {
      const finish = result => {
        if (settled) return;
        settled = true;
        window.fetch = originalFetch;
        window.XMLHttpRequest.prototype.open = originalOpen;
        window.XMLHttpRequest.prototype.send = originalSend;
        resolve(result || null);
      };
      const acceptText = (text, url) => {
        const entries = entriesFromXmlOrVtt(text);
        if (entries.length) finish({ entries, url: String(url || "") });
      };

      window.fetch = function (...args) {
        const request = originalFetch.apply(this, args);
        if (isTimedTextUrl(args[0])) {
          request.then(response => response.clone().text())
            .then(text => acceptText(text, args[0]))
            .catch(() => {});
        }
        return request;
      };
      window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__obsidianClipperTimedTextUrl = isTimedTextUrl(url) ? url : "";
        return originalOpen.call(this, method, url, ...rest);
      };
      window.XMLHttpRequest.prototype.send = function (...args) {
        if (this.__obsidianClipperTimedTextUrl) {
          this.addEventListener("load", () => {
            try {
              acceptText(this.responseText, this.__obsidianClipperTimedTextUrl);
            } catch {
              // responseText 不可读时等待 fetch 或直接读取轨道。
            }
          }, { once: true });
        }
        return originalSend.apply(this, args);
      };

      try {
        const directEntries = await fetchTrackDirect(track, translationLanguage);
        if (directEntries?.length) {
          finish({ entries: directEntries, url: track.baseUrl });
          return;
        }
      } catch {
        // 直接字幕地址不可用时，再让播放器内部 API 选轨。
      }
      await activateTrack(track, translationLanguage);

      setTimeout(() => {
        if (settled) return;
        finish(null);
      }, timeoutMs);
    });
  }

  if (!/(^|\.)youtube\.com$/i.test(location.hostname)) {
    return { ok: false, error: "当前页面不是 YouTube 视频页。" };
  }

  try {
    const pageMetadata = metadata();
    const observedUrls = observedTimedTextUrls();
    const trackData = collectTrackData();
    const plan = selectPlan(trackData);
    const availableTracks = trackData.tracks.map(publicTrack);

    if (!plan) {
      return {
        ok: false,
        ...pageMetadata,
        observedTimedTextUrls: observedUrls,
        availableTracks,
        reason: "no-subtitle-track",
        error: "这个 YouTube 视频没有平台提供的字幕轨道。"
      };
    }
    if (plan.unavailable) {
      return {
        ok: false,
        ...pageMetadata,
        observedTimedTextUrls: observedUrls,
        availableTracks,
        reason: "requested-language-unavailable",
        error: `这个 YouTube 视频没有可用的${plan.unavailable}字幕轨道。请改用“智能”或在播放器字幕菜单中手动确认。`
      };
    }

    if (!options.autoEnableSubtitles && options.subtitleMode === "follow-player") {
      const loadedEntries = entriesFromLoadedTextTracks();
      if (loadedEntries.length) {
        return {
          ok: true,
          ...pageMetadata,
          subtitleSource: "youtube-loaded-text-track",
          primaryLanguage: plan.primary.languageCode,
          selectedTrack: plan.primary.label,
          availableTracks,
          observedTimedTextUrls: observedUrls,
          entries: loadedEntries
        };
      }
    }

    const primaryResult = await captureTrack(
      plan.primary,
      plan.primaryTranslation
    );
    if (!primaryResult?.entries?.length) {
      return {
        ok: false,
        ...pageMetadata,
        observedTimedTextUrls: observedTimedTextUrls(),
        availableTracks,
        requestedPrimaryLanguage: plan.primaryTranslation?.languageCode
          || plan.primary.languageCode,
        requestedPrimaryFamily: languageFamily(
          plan.primaryTranslation?.languageCode || plan.primary.languageCode
        ),
        reason: "subtitle-activation-failed",
        error: options.autoEnableSubtitles
          ? `找到了字幕轨道“${plan.primary.label}”，但静默选择后没有读到正文。请在播放器字幕菜单手动选中该语言，再点一次剪藏。`
          : "没有读到当前播放器字幕。请手动开启并选择字幕，或打开“自动选择字幕”。"
      };
    }

    let secondaryResult = null;
    if (plan.secondary) {
      secondaryResult = await captureTrack(
        plan.secondary,
        plan.secondaryTranslation
      );
    }

    const primaryLanguage = plan.primaryTranslation?.languageCode
      || plan.primary.languageCode;
    const translationLanguage = secondaryResult?.entries?.length
      ? (plan.secondaryTranslation?.languageCode || plan.secondary.languageCode)
      : "";

    return {
      ok: true,
      ...pageMetadata,
      subtitleSource: "youtube-player-caption",
      primaryLanguage,
      translationLanguage,
      selectedTrack: plan.primaryTranslation?.label || plan.primary.label,
      secondaryTrack: translationLanguage
        ? (plan.secondaryTranslation?.label || plan.secondary.label)
        : "",
      availableTracks,
      observedTimedTextUrls: observedTimedTextUrls(),
      playerSubtitleActivated: options.autoEnableSubtitles,
      entries: primaryResult.entries,
      translationEntries: secondaryResult?.entries || []
    };
  } catch (error) {
    return {
      ok: false,
      reason: "extract-failed",
      error: `YouTube 字幕提取失败：${error?.message || String(error)}`
    };
  }
})();
