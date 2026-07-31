export const DEFAULT_SETTINGS = Object.freeze({
  vaultId: "",
  targetFolder: "Inbox/视频逐字稿",
  silentSave: true,
  includeTimestamps: false,
  subtitleMode: "smart",
  speakerMode: "single",
  autoEnableSubtitles: true
});

export const PROCESSING_RULE = Object.freeze({
  id: "video-transcript-v1",
  note: "[[视频逐字稿处理规则]]",
  url: "https://github.com/aibuqin-code/obsidian-video-transcript-clipper/blob/v0.8.1/docs/video-transcript-processing-rule.md"
});

const SPEAKER_MODES = Object.freeze({
  single: Object.freeze({
    label: "单人",
    hint: ""
  }),
  two: Object.freeze({
    label: "双人",
    hint: "本稿被用户声明为双人对谈。平台字幕没有可靠的说话人标签；后续 AI 应按称呼、问答关系、语气和上下文推断轮次，先使用“说话人 A / 说话人 B”临时标注。只有出现明确称呼、自我介绍或连续上下文证据时才能关联真实姓名；无法判断时标“说话人不确定”，不得编造归属。"
  }),
  multi: Object.freeze({
    label: "多人",
    hint: "本稿被用户声明为多人场景。平台字幕没有可靠的说话人标签；后续 AI 应按称呼、问答关系、语气和上下文推断轮次，先使用“说话人 A / B / C…”临时标注。只有出现明确称呼、自我介绍或连续上下文证据时才能关联真实姓名；无法判断时标“说话人不确定”，不得合并、补写或编造发言。"
  })
});

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

export function normalizeMultilineText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map(line => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeSpeakerMode(value) {
  return Object.hasOwn(SPEAKER_MODES, value) ? value : DEFAULT_SETTINGS.speakerMode;
}

export function cleanVideoDescription(value, {
  platform = "",
  source = ""
} = {}) {
  const normalized = normalizeMultilineText(value);
  if (!normalized) return "";
  if (source !== "page-meta-fallback" || platform !== "bilibili") {
    return normalized;
  }

  const pollutionMarkers = [
    /(?:,\s*)?视频播放量\s*\d+/i,
    /(?:,\s*)?相关视频\s*[:：]/i
  ];
  const cutAt = pollutionMarkers
    .map(pattern => normalized.search(pattern))
    .filter(index => index >= 0)
    .sort((left, right) => left - right)[0];
  return Number.isInteger(cutAt)
    ? normalized.slice(0, cutAt).replace(/[，,\s]+$/g, "").trim()
    : normalized;
}

export function inferSubtitleLanguage(entries) {
  const sample = (entries ?? [])
    .slice(0, 120)
    .map(entry => normalizeText(entry?.text))
    .join(" ")
    .slice(0, 8000)
    .toLowerCase();
  if (!sample) return "unknown";

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
    if (markerCount / latinWords.length >= 0.12) return "en";
    return "unknown-latin";
  }
  return "unknown";
}

export function dedupeConsecutive(entries) {
  const output = [];
  let previous = "";

  for (const entry of entries ?? []) {
    const text = normalizeText(entry?.text);
    if (!text || text === previous) continue;
    const startValue = entry?.start;
    const endValue = entry?.end;
    const start = startValue === null || startValue === undefined || startValue === ""
      ? null
      : Number(startValue);
    const end = endValue === null || endValue === undefined || endValue === ""
      ? null
      : Number(endValue);

    output.push({
      start: Number.isFinite(start) ? start : null,
      end: Number.isFinite(end) ? end : null,
      text,
      translation: normalizeText(entry?.translation)
    });
    previous = text;
  }

  return output;
}

function overlapSeconds(left, right) {
  if (
    left?.start === null
    || left?.start === undefined
    || right?.start === null
    || right?.start === undefined
  ) return 0;

  const leftStart = Number(left.start);
  const leftEnd = Number.isFinite(Number(left.end))
    ? Number(left.end)
    : leftStart + 2;
  const rightStart = Number(right.start);
  const rightEnd = Number.isFinite(Number(right.end))
    ? Number(right.end)
    : rightStart + 2;
  return Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
}

export function alignBilingualEntries(primaryEntries, translationEntries) {
  const primary = dedupeConsecutive(primaryEntries);
  const translation = dedupeConsecutive(translationEntries);
  if (!translation.length) return primary;

  let translationIndex = 0;
  return primary.map(entry => {
    if (entry.start === null) return entry;

    while (
      translationIndex + 1 < translation.length
      && Number(translation[translationIndex]?.end) < Number(entry.start) - 0.4
    ) {
      translationIndex += 1;
    }

    const nearby = translation.slice(
      Math.max(0, translationIndex - 1),
      Math.min(translation.length, translationIndex + 5)
    );
    const best = nearby
      .map(candidate => ({
        candidate,
        overlap: overlapSeconds(entry, candidate),
        distance: Math.abs(Number(candidate?.start) - Number(entry.start))
      }))
      .sort((left, right) => (
        right.overlap - left.overlap
        || left.distance - right.distance
      ))[0];

    const closeEnough = best && (
      best.overlap > 0
      || best.distance <= 1.2
    );
    return {
      ...entry,
      translation: closeEnough ? best.candidate.text : ""
    };
  });
}

export function formatTimestamp(seconds) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) < 0) return "";

  const total = Math.floor(Number(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return [hours, minutes, secs].map(value => String(value).padStart(2, "0")).join(":");
  }
  return [minutes, secs].map(value => String(value).padStart(2, "0")).join(":");
}

function yamlString(value) {
  return JSON.stringify(String(value ?? "").replace(/\r?\n/g, " "));
}

function safeInline(value) {
  return normalizeText(value).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "").trim();
}

export function safeFileName(value, fallback = "未命名视频") {
  const cleaned = safeInline(value)
    .replace(/[. ]+$/g, "")
    .slice(0, 90);
  return cleaned || fallback;
}

function localDateTime(date) {
  const pad = value => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + "T" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join(":");
}

function localDate(date) {
  return localDateTime(date).slice(0, 10);
}

function formatDuration(seconds) {
  const stamp = formatTimestamp(seconds);
  return stamp || "未知";
}

export function buildMarkdown(payload, now = new Date(), options = {}) {
  const entries = payload?.translationEntries?.length
    ? alignBilingualEntries(payload?.entries, payload.translationEntries)
    : dedupeConsecutive(payload?.entries);
  if (entries.length === 0) {
    throw new Error("没有可写入的字幕条目");
  }

  const platform = normalizeText(payload.platform) || "video";
  const title = normalizeText(payload.title) || "视频逐字稿";
  const author = normalizeText(payload.author);
  const descriptionSource = normalizeText(payload.descriptionSource)
    || (payload.description ? "page-meta-fallback" : "none");
  const descriptionQuality = normalizeText(payload.descriptionQuality)
    || (descriptionSource === "page-meta-fallback" ? "fallback" : "platform-native");
  const description = cleanVideoDescription(payload.description, {
    platform,
    source: descriptionSource
  });
  const url = String(payload.url ?? "");
  const videoId = normalizeText(payload.videoId);
  const subtitleSource = normalizeText(payload.subtitleSource) || "unknown";
  const primaryLanguage = normalizeText(payload.primaryLanguage);
  const translationLanguage = normalizeText(payload.translationLanguage);
  const subtitleMode = translationLanguage ? "bilingual" : "single";
  const speakerMode = normalizeSpeakerMode(options.speakerMode);
  const speaker = SPEAKER_MODES[speakerMode];
  const hasTimestamps = entries.some(entry => entry.start !== null);
  const includeTimestamps = (options.includeTimestamps ?? true) && hasTimestamps;
  const capturedAt = localDateTime(now);

  const frontmatter = [
    "---",
    "type: video-transcript",
    "status: raw",
    "processing_status: pending",
    `platform: ${yamlString(platform)}`,
    `title: ${yamlString(title)}`,
    `source: ${yamlString(url)}`,
    `video_id: ${yamlString(videoId)}`,
    `author: ${yamlString(author)}`,
    `captured_at: ${yamlString(capturedAt)}`,
    `subtitle_source: ${yamlString(subtitleSource)}`,
    `subtitle_mode: ${yamlString(subtitleMode)}`,
    `speaker_mode: ${yamlString(speakerMode)}`,
    `speaker_attribution: ${yamlString(speakerMode === "single" ? "not-requested" : "ai-inference-required")}`,
    "speakers: []",
    "speaker_identity_status: unconfirmed",
    `processing_rule: ${yamlString(PROCESSING_RULE.id)}`,
    `processing_rule_note: ${yamlString(PROCESSING_RULE.note)}`,
    `primary_language: ${yamlString(primaryLanguage)}`,
    `translation_language: ${yamlString(translationLanguage)}`,
    `description_source: ${yamlString(descriptionSource)}`,
    `description_quality: ${yamlString(descriptionQuality)}`,
    `timestamps: ${includeTimestamps ? "included" : "omitted"}`,
    "transcript_quality: auto-generated",
    "tags: [clip, video-transcript, inbox]",
    "---"
  ].join("\n");

  const info = [
    `- 视频：${url ? `[${title}](${url})` : title}`,
    `- 作者/频道：${author || "未识别"}`,
    `- 平台标识：${videoId || "未识别"}`,
    `- 时长：${formatDuration(payload.duration)}`,
    `- 字幕来源：${subtitleSource}`,
    `- 主字幕语言：${primaryLanguage || "未识别"}`,
    `- 辅助翻译语言：${translationLanguage || "无"}`,
    `- 说话人模式：${speaker.label}（${speakerMode === "single" ? "默认" : "剪藏时手动声明"}）`,
    `- 简介来源：${descriptionSource}`,
    `- 处理规则：${PROCESSING_RULE.note}`,
    `- 抓取时间：${capturedAt}`,
    `- 条目数：${entries.length}`
  ].join("\n");

  const transcript = entries
    .map(entry => {
      const timestamp = includeTimestamps ? formatTimestamp(entry.start) : "";
      const text = entry.translation
        ? `${entry.text}\n\n> ${entry.translation}`
        : entry.text;
      return timestamp ? `**${timestamp}**  \n${text}` : text;
    })
    .join("\n\n");

  const descriptionNotice = descriptionQuality === "platform-native"
    ? "以下内容来自平台的视频详情字段。扩展不会把页面推荐列表拼进来；作者主动写入的往期视频或相关链接仍按原文保留。"
    : "以下内容来自网页 Meta 兜底，可能被截断或混入平台模板、推荐标题；后续 AI 不得把它当作视频正文或说话内容。";
  const descriptionSection = description
    ? `\n\n## 平台简介\n\n> [!info] 简介来源\n> ${descriptionNotice}\n\n${description}`
    : "";
  const speakerSection = speaker.hint
    ? `\n\n## AI 说话人处理提示\n\n> [!important] 用户声明：${speaker.label}\n> ${speaker.hint}\n>\n> 规则：${PROCESSING_RULE.note} · [公开版 ${PROCESSING_RULE.id}](${PROCESSING_RULE.url})`
    : "";

  const translationWarning = translationLanguage
    ? "本稿以原语言字幕为证据主轨，中文翻译仅作辅助；两条轨道由时间位置自动对齐，可能存在错位或翻译误差。"
    : "";
  const warning = includeTimestamps
    ? "本稿来自平台已有字幕轨道，时间戳和文字均可能存在自动识别误差。涉及事实、人物观点和专有名词时，应回到原视频核对。"
    : hasTimestamps
      ? "本稿来自平台已有字幕轨道，但本次导出按设置省略了时间戳，以便连续阅读。文字可能存在自动识别、断句和遗漏问题；涉及事实、人物观点和专有名词时，应回到原视频核对。"
      : "本稿来自平台提供的字幕文本，但原页面没有提供可复用时间戳。文字可能存在自动识别、断句和遗漏问题；涉及事实、人物观点和专有名词时，应回到原视频核对。";

  return `${frontmatter}

# ${title} · 逐字稿

> [!warning] 证据边界
> ${warning}${translationWarning ? `\n> ${translationWarning}` : ""}

## 视频信息

${info}${speakerSection}${descriptionSection}

## 逐字稿

${transcript}
`;
}

export function buildFilePath(payload, settings, now = new Date()) {
  const folder = String(settings?.targetFolder ?? DEFAULT_SETTINGS.targetFolder)
    .replace(/^\/+|\/+$/g, "");
  const title = safeFileName(payload?.title);
  const videoId = safeFileName(payload?.videoId ?? "", "").slice(0, 20);
  const suffix = videoId ? ` ${videoId}` : "";
  const filename = `${localDate(now)} ${title}${suffix} 逐字稿.md`;
  return folder ? `${folder}/${filename}` : filename;
}

export function buildObsidianUri(filePath, settings) {
  const vault = String(settings?.vaultId ?? DEFAULT_SETTINGS.vaultId).trim();
  if (!vault) throw new Error("Vault ID 不能为空");

  const parts = [
    `vault=${encodeURIComponent(vault)}`,
    `file=${encodeURIComponent(filePath)}`,
    "clipboard"
  ];
  if (settings?.silentSave ?? DEFAULT_SETTINGS.silentSave) parts.push("silent");
  return `obsidian://new?${parts.join("&")}`;
}
