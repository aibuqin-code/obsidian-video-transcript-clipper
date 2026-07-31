import {
  DEFAULT_SETTINGS,
  buildFilePath,
  buildMarkdown,
  dedupeConsecutive
} from "./lib/transcript.mjs";
import {
  saveMarkdownViaRest,
  testObsidianRestConnection
} from "./lib/obsidian-rest.mjs";
import { detectPlatform } from "./lib/platform.mjs";
import {
  buildDiscussionFilePath,
  buildDiscussionMarkdown
} from "./lib/linuxdo.mjs";

const elements = {
  targetFolder: document.querySelector("#target-folder"),
  linuxdoTargetFolder: document.querySelector("#linuxdo-target-folder"),
  linuxdoScope: document.querySelector("#linuxdo-scope"),
  restApiUrl: document.querySelector("#rest-api-url"),
  restApiKey: document.querySelector("#rest-api-key"),
  testConnection: document.querySelector("#test-connection"),
  includeTimestamps: document.querySelector("#include-timestamps"),
  subtitleMode: document.querySelector("#subtitle-mode"),
  speakerMode: document.querySelector("#speaker-mode"),
  autoEnableSubtitles: document.querySelector("#auto-enable-subtitles"),
  save: document.querySelector("#save"),
  copy: document.querySelector("#copy"),
  download: document.querySelector("#download"),
  status: document.querySelector("#status"),
  previewPanel: document.querySelector("#preview-panel"),
  preview: document.querySelector("#preview"),
  platformLabel: document.querySelector("#platform-label")
};

let cachedResult = null;
let loadedSettings = { ...DEFAULT_SETTINGS };
let activePlatform = null;

function setStatus(message, kind = "neutral") {
  elements.status.textContent = message;
  elements.status.dataset.kind = kind;
  elements.status.hidden = !message;
}

function setBusy(isBusy) {
  elements.save.disabled = isBusy;
  elements.copy.disabled = isBusy;
  elements.download.disabled = isBusy;
  elements.testConnection.disabled = isBusy;
}

function currentSettings() {
  return {
    ...loadedSettings,
    targetFolder: elements.targetFolder.value.trim(),
    linuxdoTargetFolder: elements.linuxdoTargetFolder.value.trim(),
    linuxdoScope: elements.linuxdoScope.value,
    restApiUrl: elements.restApiUrl.value.trim(),
    restApiKey: elements.restApiKey.value.trim(),
    includeTimestamps: elements.includeTimestamps.checked,
    subtitleMode: elements.subtitleMode.value,
    speakerMode: elements.speakerMode.value,
    autoEnableSubtitles: elements.autoEnableSubtitles.checked
  };
}

async function persistSettings() {
  await chrome.storage.local.set({ settings: currentSettings() });
}

async function loadSettings() {
  const stored = await chrome.storage.local.get("settings");
  const settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  loadedSettings = settings;
  elements.targetFolder.value = settings.targetFolder;
  elements.linuxdoTargetFolder.value = settings.linuxdoTargetFolder;
  elements.linuxdoScope.value = settings.linuxdoScope;
  elements.restApiUrl.value = settings.restApiUrl;
  elements.restApiKey.value = settings.restApiKey;
  elements.includeTimestamps.checked = settings.includeTimestamps;
  elements.subtitleMode.value = settings.subtitleMode;
  elements.speakerMode.value = settings.speakerMode;
  elements.autoEnableSubtitles.checked = settings.autoEnableSubtitles;
}

async function activeSupportedTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  const platform = detectPlatform(tab?.url);
  if (!tab?.id || !platform) {
    throw new Error("请先打开受支持的视频页面或 linux.do 主题。");
  }
  return { tab, platform };
}

function setPlatformPresentation(platform) {
  activePlatform = platform;
  const isDiscussion = platform?.kind === "discussion-thread";
  document.querySelectorAll(".video-only").forEach(element => {
    element.hidden = isDiscussion;
  });
  document.querySelectorAll(".linuxdo-only").forEach(element => {
    element.hidden = !isDiscussion;
  });
  elements.platformLabel.textContent = platform?.label || "未识别";
}

async function extract() {
  if (cachedResult) return cachedResult;

  const { tab, platform } = await activeSupportedTab();
  setPlatformPresentation(platform);
  const settings = currentSettings();
  setStatus(platform.kind === "discussion-thread"
    ? `正在读取 ${platform.label} 完整主题……`
    : settings.autoEnableSubtitles
      ? `正在静默选择并读取${platform.label}字幕……`
      : `正在读取${platform.label}当前字幕……`
  );

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: options => {
      window.__OBSIDIAN_VIDEO_CLIPPER_OPTIONS__ = options;
      window.__OBSIDIAN_KNOWLEDGE_CLIPPER_OPTIONS__ = options;
    },
    args: [{
      subtitleMode: settings.subtitleMode,
      autoEnableSubtitles: settings.autoEnableSubtitles,
      postScope: settings.linuxdoScope
    }]
  });

  const injection = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    files: [platform.script]
  });
  const result = injection?.[0]?.result;

  const backgroundMessage = platform.id === "bilibili"
    ? "EXTRACT_BILIBILI_SUBTITLE"
    : platform.id === "youtube"
      ? "EXTRACT_YOUTUBE_SUBTITLE"
      : null;
  const backgroundResult = backgroundMessage
    && !result?.ok
    && result?.reason !== "requested-language-unavailable"
    ? await chrome.runtime.sendMessage({
      type: backgroundMessage,
      payload: {
        tabId: tab.id,
        pageUrl: tab.url,
        subtitleMode: settings.subtitleMode,
        requestedFamily: result?.requestedPrimaryFamily || "",
        observedUrls: result?.observedSubtitleUrls
          || result?.observedTimedTextUrls
          || []
      }
    }).catch(() => null)
    : null;

  if (backgroundResult?.ok) {
    cachedResult = {
      ...(result || {}),
      ...backgroundResult,
      ok: true
    };
    return cachedResult;
  }

  if (!result?.ok) {
    const error = new Error(
      result?.error
      || backgroundResult?.error
      || `${platform.label}字幕提取没有返回结果。`
    );
    error.reason = result?.reason;
    throw error;
  }
  cachedResult = result;
  return result;
}

async function prepareMarkdown() {
  const result = await extract();
  const now = new Date();
  const settings = currentSettings();
  const isDiscussion = result.kind === "discussion-thread";
  const markdown = isDiscussion
    ? buildDiscussionMarkdown(result, now, { postScope: settings.linuxdoScope })
    : buildMarkdown(result, now, {
      includeTimestamps: settings.includeTimestamps,
      speakerMode: settings.speakerMode
    });
  const filePath = isDiscussion
    ? buildDiscussionFilePath(result, settings)
    : buildFilePath(result, settings, now);
  if (elements.preview) {
    elements.preview.value = markdown;
    elements.previewPanel.hidden = false;
  }
  const itemSummary = isDiscussion
    ? `${result.posts.length} / ${result.totalPostCount || result.posts.length} 个楼层`
    : `${result.translationLanguage
      ? `${result.primaryLanguage || "原语言"} + ${result.translationLanguage}`
      : (result.primaryLanguage || "语言未识别")}，共 ${dedupeConsecutive(result.entries).length} 条字幕`;
  return { result, markdown, filePath, itemSummary };
}

async function copyMarkdown(markdown) {
  try {
    window.focus();
    await navigator.clipboard.writeText(markdown);
    return;
  } catch (clipboardError) {
    const fallback = document.createElement("textarea");
    fallback.value = markdown;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.focus();
    fallback.select();
    const copied = document.execCommand("copy");
    fallback.remove();
    if (!copied) throw clipboardError;
  }
}

function resetPresentation() {
  elements.previewPanel.hidden = true;
  elements.preview.value = "";
  setStatus("");
}

function resetExtraction() {
  cachedResult = null;
  resetPresentation();
}

async function persistExtractionSettings() {
  resetExtraction();
  await persistSettings();
}

async function persistRenderSettings() {
  resetPresentation();
  await persistSettings();
}

async function saveToObsidian() {
  setBusy(true);
  try {
    await persistSettings();
    const {
      markdown,
      filePath,
      itemSummary
    } = await prepareMarkdown();
    const settings = currentSettings();
    setStatus("正在后台写入 Obsidian……");
    const saved = await saveMarkdownViaRest({
      filePath,
      markdown,
      restApiUrl: settings.restApiUrl,
      restApiKey: settings.restApiKey
    });
    const headline = saved.status === "unchanged"
      ? "这份剪藏已经存在，无需重复写入。"
      : saved.status === "created-with-suffix"
        ? "同名文件已存在，已静默另存一份。"
        : "已静默存入 Obsidian，未切换窗口。";
    setStatus(
      `${headline}\n${saved.filePath}\n\n${itemSummary}。`,
      "success"
    );
  } catch (error) {
    const suffix = error?.reason === "no-subtitle-track"
      ? "\n\n这不是保存故障：当前页面没有平台现成字幕。Mac 端不会启动本地转写模型。"
      : "";
    setStatus(`${error?.message || String(error)}${suffix}`, "error");
  } finally {
    setBusy(false);
  }
}

async function testConnection() {
  setBusy(true);
  try {
    await persistSettings();
    setStatus("正在检查 Obsidian 后台连接……");
    await testObsidianRestConnection(currentSettings());
    setStatus("连接成功。之后可静默写入，不会唤起或切换 Obsidian 窗口。", "success");
  } catch (error) {
    setStatus(error?.message || String(error), "error");
  } finally {
    setBusy(false);
  }
}

async function copyOnly() {
  setBusy(true);
  try {
    await persistSettings();
    const { markdown, itemSummary } = await prepareMarkdown();
    await copyMarkdown(markdown);
    setStatus(
      `Markdown 已复制：${itemSummary}。`,
      "success"
    );
  } catch (error) {
    setStatus(error?.message || String(error), "error");
  } finally {
    setBusy(false);
  }
}

async function downloadMarkdown() {
  setBusy(true);
  try {
    await persistSettings();
    const {
      markdown,
      filePath,
      itemSummary
    } = await prepareMarkdown();
    const filename = filePath.split("/").pop();
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(
      `已下载 ${filename}：${itemSummary}。`,
      "success"
    );
  } catch (error) {
    setStatus(error?.message || String(error), "error");
  } finally {
    setBusy(false);
  }
}

elements.save.addEventListener("click", saveToObsidian);
elements.testConnection.addEventListener("click", testConnection);
elements.copy.addEventListener("click", copyOnly);
elements.download.addEventListener("click", downloadMarkdown);
elements.targetFolder.addEventListener("change", persistSettings);
elements.linuxdoTargetFolder.addEventListener("change", persistSettings);
elements.restApiUrl.addEventListener("change", persistSettings);
elements.restApiKey.addEventListener("change", persistSettings);
elements.includeTimestamps.addEventListener("change", persistRenderSettings);
elements.speakerMode.addEventListener("change", persistRenderSettings);
elements.subtitleMode.addEventListener("change", persistExtractionSettings);
elements.autoEnableSubtitles.addEventListener("change", persistExtractionSettings);
elements.linuxdoScope.addEventListener("change", persistExtractionSettings);

loadSettings().catch(error => setStatus(error?.message || String(error), "error"));

activeSupportedTab()
  .then(({ platform }) => {
    setPlatformPresentation(platform);
  })
  .catch(() => {
    activePlatform = null;
    elements.platformLabel.textContent = "视频 · linux.do";
  });
