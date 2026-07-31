# Changelog

## 1.0.0 - 2026-07-31

- Expanded the product from a video-only clipper to a multi-source Obsidian capture tool.
- Added a linux.do adapter that reads complete accessible topics without requiring a full-page scroll.
- Added main post, topic-author replies and all-floor capture scopes.
- Preserved floor metadata, topic-author markers, reply relationships, remote images, quotes, code, lists and tables.
- Added source-specific target folders and `discussion-thread-v1` pending-processing metadata.
- Documented the complementary boundary with Obsidian Web Clipper.
- Credited the MIT-licensed `linux.do 帖子保存到 Obsidian` userscript by `zsq`.
- Kept all existing Bilibili, YouTube, Xiaoe and background-save behavior.

## 0.9.0 - 2026-07-31

- Replaced foreground-activating `obsidian://` saves with authenticated Local REST API writes.
- Added a compact connection test and clear success/failure feedback.
- Added exact read-back verification before reporting success.
- Identical notes are not duplicated; conflicting paths are saved with a numeric suffix instead of overwritten.
- Restricted API endpoints to local loopback addresses and kept the API key in browser-local storage only.
- Added seven REST-save tests; the full suite now contains 27 tests.

## 0.8.1 - 2026-07-31

- Added `processing_status: pending` to new raw transcripts.
- Added portable `[[视频逐字稿处理规则]]` links and empty speaker identity fields.
- Documented natural requests such as “process this” and “discuss this video”.
- Separated no-write discussion, readable transcript derivatives, and durable source interpretation.

## 0.8.0 - 2026-07-31

- Added a single/two/multi speaker-mode selector; single remains the default.
- Added AI speaker-attribution boundaries only when two or multi is selected.
- Preferred Bilibili video-detail and YouTube player-response descriptions.
- Trimmed known Bilibili page-Meta recommendation pollution when native metadata is unavailable.
- Recorded description source/quality and processing-rule version in Markdown.
- Added `video-transcript-v1` as the shared post-processing specification.

## 0.7.0 - 2026-07-31

- Added a new extension icon and clearer product description.
- Added smart Chinese/English/bilingual subtitle policies.
- Added Bilibili, YouTube, and experimental Xiaoe adapters.
- Added optional timestamps, Markdown preview/download, and Obsidian URI save.
- Removed personal defaults from distributable source.
