# Changelog

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
