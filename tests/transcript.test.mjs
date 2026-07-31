import assert from "node:assert/strict";
import test from "node:test";

import {
  alignBilingualEntries,
  buildFilePath,
  buildMarkdown,
  buildObsidianUri,
  cleanVideoDescription,
  DEFAULT_SETTINGS,
  dedupeConsecutive,
  formatTimestamp,
  inferSubtitleLanguage,
  normalizeSpeakerMode,
  safeFileName
} from "../lib/transcript.mjs";
import {
  buildSubtitleViewUrl,
  extractSubtitleUrls,
  isSubtitleResourceUrl,
  parseBvid,
  subtitleEntriesFromJson
} from "../lib/bilibili.mjs";
import { detectPlatform } from "../lib/platform.mjs";
import {
  captionTrackDescriptorsFromPlayerResponse,
  captionTracksFromPlayerResponse,
  chooseCaptionTrack,
  entriesFromYoutubeJson3,
  sourceCaptionTrack,
  youtubeLanguageFamily,
  youtubeVideoId
} from "../lib/youtube.mjs";
import {
  inlineEntriesFromXiaoePayload,
  parseTimedText,
  subtitleUrlsFromXiaoePayload,
  xiaoeResourceId
} from "../lib/xiaoe.mjs";

test("只删除连续重复字幕，不误删课程中稍后重复的句子", () => {
  const entries = dedupeConsecutive([
    { start: 0, text: "开始" },
    { start: 1, text: "开始" },
    { start: 2, text: "继续" },
    { start: 3, text: "开始" }
  ]);
  assert.deepEqual(entries.map(item => item.text), ["开始", "继续", "开始"]);
});

test("AI 小助手没有时间戳时保持为空，不伪造 00:00", () => {
  const entries = dedupeConsecutive([
    { start: null, end: null, text: "没有时间戳" }
  ]);
  assert.equal(entries[0].start, null);
  assert.equal(entries[0].end, null);
});

test("时间戳按课程时长生成", () => {
  assert.equal(formatTimestamp(65.8), "01:05");
  assert.equal(formatTimestamp(3665.2), "01:01:05");
});

test("无语言描述的字幕不会把葡萄牙语误标为中文或英文", () => {
  assert.equal(inferSubtitleLanguage([
    { text: "这是一个用于语言识别的中文测试。" },
    { text: "第二句话仍然使用中文。" }
  ]), "zh");
  assert.equal(inferSubtitleLanguage([
    { text: "This sentence is written in English." },
    { text: "The next sentence is also in English." }
  ]), "en");
  assert.equal(inferSubtitleLanguage([
    { text: "Esta frase está escrita em português." },
    { text: "A segunda frase também está em português." }
  ]), "unknown-latin");
  assert.equal(inferSubtitleLanguage([
    { text: "これは日本語で書かれたテスト文です。" },
    { text: "次の文も日本語です。" }
  ]), "ja");
  assert.equal(inferSubtitleLanguage([
    { text: "이 문장은 한국어로 작성된 테스트입니다." }
  ]), "ko");
});

test("文件名移除不安全字符", () => {
  assert.equal(safeFileName('A/B: "课程"? *'), "AB 课程");
});

test("生成带证据边界和时间戳的 Markdown", () => {
  const markdown = buildMarkdown({
    title: "测试课程",
    url: "https://www.bilibili.com/video/BV1TEST",
    videoId: "BV1TEST",
    author: "老师",
    duration: 125,
    subtitleSource: "bilibili-ai-subtitle",
    entries: [
      { start: 0, end: 2, text: "第一句" },
      { start: 65, end: 67, text: "第二句" }
    ]
  }, new Date(2026, 6, 31, 12, 30, 0), { includeTimestamps: true });

  assert.match(markdown, /type: video-transcript/);
  assert.match(markdown, /timestamps: included/);
  assert.match(markdown, /证据边界/);
  assert.match(markdown, /\*\*01:05\*\*/);
  assert.match(markdown, /第二句/);
});

test("默认是单人模式，且不会触发 AI 分角色提示", () => {
  assert.equal(DEFAULT_SETTINGS.speakerMode, "single");
  assert.equal(normalizeSpeakerMode("invalid"), "single");

  const markdown = buildMarkdown({
    title: "单人课程",
    entries: [{ start: 0, end: 2, text: "大家好，今天开始上课。" }]
  }, new Date(2026, 6, 31, 12, 30, 0), {
    includeTimestamps: false
  });

  assert.match(markdown, /speaker_mode: "single"/);
  assert.match(markdown, /speaker_attribution: "not-requested"/);
  assert.match(markdown, /processing_status: pending/);
  assert.match(markdown, /processing_rule: "video-transcript-v1"/);
  assert.match(markdown, /processing_rule_note: "\[\[视频逐字稿处理规则\]\]"/);
  assert.match(markdown, /speakers: \[\]/);
  assert.match(markdown, /speaker_identity_status: unconfirmed/);
  assert.match(markdown, /处理规则：\[\[视频逐字稿处理规则\]\]/);
  assert.doesNotMatch(markdown, /## AI 说话人处理提示/);
  assert.doesNotMatch(markdown, /说话人 A/);
});

test("只有手动选择双人或多人时才加入 AI 说话人切分规则", () => {
  const payload = {
    title: "对谈",
    entries: [
      { start: 0, end: 2, text: "你为什么选择这个动作？" },
      { start: 2, end: 4, text: "因为它更容易控制。" }
    ]
  };
  const two = buildMarkdown(
    payload,
    new Date(2026, 6, 31, 12, 30, 0),
    { includeTimestamps: false, speakerMode: "two" }
  );
  const multi = buildMarkdown(
    payload,
    new Date(2026, 6, 31, 12, 30, 0),
    { includeTimestamps: false, speakerMode: "multi" }
  );

  assert.match(two, /speaker_mode: "two"/);
  assert.match(two, /用户声明：双人/);
  assert.match(two, /说话人 A \/ 说话人 B/);
  assert.match(two, /不得编造归属/);
  assert.match(multi, /speaker_mode: "multi"/);
  assert.match(multi, /用户声明：多人/);
  assert.match(multi, /说话人 A \/ B \/ C/);
  assert.match(multi, /不得合并、补写或编造发言/);
});

test("B站 Meta 兜底会切掉推荐区污染，平台原生简介保留作者写入的往期列表", () => {
  const contaminatedMeta = [
    "本期演示如何整理一段公开课程字幕",
    "以下为往期内容：示例课程第一讲 BV1DEMO00001",
    "视频播放量 100、弹幕量 10、点赞数 20",
    "相关视频：示例推荐标题"
  ].join(", ");
  const nativeDescription = [
    "本期演示如何整理一段公开课程字幕",
    "以下为往期内容：",
    "示例课程第一讲 BV1DEMO00001",
    "示例课程第二讲 BV1DEMO00002"
  ].join("\n");

  const fallback = cleanVideoDescription(contaminatedMeta, {
    platform: "bilibili",
    source: "page-meta-fallback"
  });
  const native = cleanVideoDescription(nativeDescription, {
    platform: "bilibili",
    source: "bilibili-view-api"
  });

  assert.match(fallback, /示例课程第一讲/);
  assert.doesNotMatch(fallback, /视频播放量/);
  assert.doesNotMatch(fallback, /相关视频/);
  assert.match(native, /示例课程第二讲/);
  assert.match(native, /\n以下为往期内容[:：]\n/);
});

test("简介来源进入 Markdown，Meta 回退明确警告不能当视频正文", () => {
  const markdown = buildMarkdown({
    platform: "bilibili",
    title: "简介回退测试",
    description: "视频自己的简介, 视频播放量 100, 相关视频：推荐标题",
    descriptionSource: "page-meta-fallback",
    descriptionQuality: "fallback",
    entries: [{ start: 0, end: 1, text: "正文" }]
  }, new Date(2026, 6, 31, 12, 30, 0), {
    includeTimestamps: false
  });

  assert.match(markdown, /description_source: "page-meta-fallback"/);
  assert.match(markdown, /可能被截断或混入平台模板、推荐标题/);
  assert.match(markdown, /不得把它当作视频正文或说话内容/);
  assert.doesNotMatch(markdown, /视频播放量 100/);
  assert.doesNotMatch(markdown, /相关视频[:：]推荐标题/);
});

test("可按阅读需求省略时间戳但保留全部字幕", () => {
  const markdown = buildMarkdown({
    title: "无时间戳阅读版",
    subtitleSource: "bilibili-ai-subtitle",
    entries: [
      { start: 0, end: 2, text: "第一句" },
      { start: 65, end: 67, text: "第二句" }
    ]
  }, new Date(2026, 6, 31, 12, 30, 0), { includeTimestamps: false });

  assert.match(markdown, /timestamps: omitted/);
  assert.match(markdown, /本次导出按设置省略了时间戳/);
  assert.match(markdown, /第一句/);
  assert.match(markdown, /第二句/);
  assert.doesNotMatch(markdown, /\*\*00:00\*\*/);
  assert.doesNotMatch(markdown, /\*\*01:05\*\*/);
});

test("英文原轨与中文辅助轨按时间对齐，英文不能被翻译替换", () => {
  const aligned = alignBilingualEntries([
    { start: 0, end: 2.2, text: "Original English sentence." },
    { start: 2.2, end: 4.5, text: "The second sentence." }
  ], [
    { start: 0.1, end: 2.3, text: "英文原句的中文翻译。" },
    { start: 2.3, end: 4.6, text: "第二句话。" }
  ]);

  assert.equal(aligned[0].text, "Original English sentence.");
  assert.equal(aligned[0].translation, "英文原句的中文翻译。");
  assert.equal(aligned[1].translation, "第二句话。");
});

test("中英双语 Markdown 标明英文主轨与中文辅助翻译", () => {
  const markdown = buildMarkdown({
    title: "Bilingual lesson",
    subtitleSource: "youtube-caption-track",
    primaryLanguage: "en",
    translationLanguage: "zh-Hans",
    entries: [
      { start: 0, end: 2, text: "Keep the original." }
    ],
    translationEntries: [
      { start: 0, end: 2, text: "保留英文原文。" }
    ]
  }, new Date(2026, 6, 31, 12, 30, 0), { includeTimestamps: false });

  assert.match(markdown, /subtitle_mode: "bilingual"/);
  assert.match(markdown, /primary_language: "en"/);
  assert.match(markdown, /translation_language: "zh-Hans"/);
  assert.match(markdown, /Keep the original\./);
  assert.match(markdown, /> 保留英文原文。/);
  assert.match(markdown, /原语言字幕为证据主轨/);
});

test("生成稳定的 Obsidian 路径和剪贴板 URI", () => {
  const now = new Date(2026, 6, 31, 12, 30, 0);
  const settings = {
    vaultId: "vault-id",
    targetFolder: "Inbox/Video Transcripts",
    silentSave: true
  };
  const filePath = buildFilePath({
    title: "示例课程",
    videoId: "BV1DEMO00001"
  }, settings, now);
  const uri = buildObsidianUri(filePath, settings);

  assert.equal(
    filePath,
    "Inbox/Video Transcripts/2026-07-31 示例课程 BV1DEMO00001 逐字稿.md"
  );
  assert.match(uri, /^obsidian:\/\/new\?/);
  assert.match(uri, /vault=vault-id/);
  assert.match(uri, /clipboard(?:&|$)/);
  assert.match(uri, /silent(?:&|$)/);
  assert.doesNotMatch(uri, /\+/);
  assert.match(uri, /2026-07-31%20%E7%A4%BA%E4%BE%8B%E8%AF%BE%E7%A8%8B/);
  assert.doesNotMatch(uri, /content=/);
});

test("识别并解析 B 站 AI 字幕资源", () => {
  const url = "https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/demo?auth_key=temp";
  assert.equal(isSubtitleResourceUrl(url), true);
  assert.deepEqual(extractSubtitleUrls({
    data: {
      subtitles: [{ lan: "ai-zh", subtitle_url: url }]
    }
  }), [url]);
  assert.deepEqual(subtitleEntriesFromJson({
    type: "AIsubtitle",
    body: [{ from: 0.66, to: 1.5, content: " 哈喽  大家好 " }]
  }), [{ start: 0.66, end: 1.5, text: "哈喽 大家好" }]);
});

test("生成新版字幕接口并解析 BV 号", () => {
  assert.equal(
    parseBvid("https://www.bilibili.com/video/BV1DEMO00001/?x=1"),
    "BV1DEMO00001"
  );
  const url = buildSubtitleViewUrl({ aid: 123, cid: 456 });
  assert.match(url, /x\/v2\/subtitle\/web\/view/);
  assert.match(url, /oid=456/);
  assert.match(url, /pid=123/);
});

test("识别三类受支持的视频页面", () => {
  assert.equal(
    detectPlatform("https://www.bilibili.com/video/BV1TEST")?.id,
    "bilibili"
  );
  assert.equal(
    detectPlatform("https://www.youtube.com/watch?v=demo")?.id,
    "youtube"
  );
  assert.equal(
    detectPlatform("https://appdemo.h5.xet.pomoho.com/v4/course/alive/l_demo")?.id,
    "xiaoe"
  );
  assert.equal(detectPlatform("https://example.com/video"), null);
});

test("解析 YouTube captionTracks 与 json3 字幕", () => {
  assert.equal(youtubeLanguageFamily("en-US"), "en");
  assert.equal(youtubeLanguageFamily("zh-CN"), "zh");
  const tracks = captionTracksFromPlayerResponse({
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          { languageCode: "en", baseUrl: "https://www.youtube.com/api/timedtext?lang=en" },
          { languageCode: "zh-CN", baseUrl: "https://www.youtube.com/api/timedtext?lang=zh-CN" }
        ]
      }
    }
  });
  assert.equal(chooseCaptionTrack(tracks)?.languageCode, "zh-CN");
  assert.equal(youtubeVideoId("https://www.youtube.com/watch?v=abc123"), "abc123");
  assert.deepEqual(entriesFromYoutubeJson3({
    events: [{
      tStartMs: 1500,
      dDurationMs: 2200,
      segs: [{ utf8: "你好" }, { utf8: " 世界" }]
    }]
  }), [{ start: 1.5, end: 3.7, text: "你好 世界" }]);
});

test("YouTube 智能模式按默认字幕识别原声，不因同时有英文轨而误判", () => {
  const chineseOriginal = captionTrackDescriptorsFromPlayerResponse({
    captions: {
      playerCaptionsTracklistRenderer: {
        defaultAudioTrackIndex: 0,
        audioTracks: [{
          hasDefaultTrack: true,
          defaultCaptionTrackIndex: 1,
          captionTrackIndices: [0, 1]
        }],
        captionTracks: [
          {
            languageCode: "en",
            name: { simpleText: "English" }
          },
          {
            languageCode: "zh-CN",
            kind: "asr",
            name: { simpleText: "中文（自动生成）" }
          }
        ]
      }
    }
  });
  const englishOriginal = captionTrackDescriptorsFromPlayerResponse({
    captions: {
      playerCaptionsTracklistRenderer: {
        defaultAudioTrackIndex: 0,
        audioTracks: [{
          hasDefaultTrack: true,
          defaultCaptionTrackIndex: 0,
          captionTrackIndices: [0, 1]
        }],
        captionTracks: [
          {
            languageCode: "en",
            name: { simpleText: "English" }
          },
          {
            languageCode: "zh-CN",
            name: { simpleText: "Chinese (China)" }
          }
        ]
      }
    }
  });

  assert.equal(sourceCaptionTrack(chineseOriginal)?.family, "zh");
  assert.equal(sourceCaptionTrack(englishOriginal)?.family, "en");
});

test("解析小鹅通 VTT、内联字幕和资源标识", () => {
  assert.equal(
    xiaoeResourceId("https://appdemo.h5.xet.pomoho.com/v4/course/alive/l_demo?x=1"),
    "l_demo"
  );
  assert.deepEqual(parseTimedText(`WEBVTT

00:00:01.000 --> 00:00:03.500
第一句

2
00:01:05,000 --> 00:01:07,000
第二句
`), [
    { start: 1, end: 3.5, text: "第一句" },
    { start: 65, end: 67, text: "第二句" }
  ]);
  assert.deepEqual(inlineEntriesFromXiaoePayload({
    data: {
      subtitles: [{ start_time: 1000, end_time: 2200, content: " 开始 " }]
    }
  }), [{ start: 1000, end: 2200, text: "开始" }]);
  assert.deepEqual(subtitleUrlsFromXiaoePayload({
    data: { subtitle_url: "https://cdn.example.com/demo.vtt?sign=hidden" }
  }), ["https://cdn.example.com/demo.vtt?sign=hidden"]);
});
