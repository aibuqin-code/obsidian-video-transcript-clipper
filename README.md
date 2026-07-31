# Obsidian Multi-Source Clipper

> Bilibili / YouTube / Xiaoe transcripts and complete linux.do discussions to Obsidian

![Chrome Extension](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)
![Obsidian](https://img.shields.io/badge/Obsidian-Markdown-7C3AED?logo=obsidian&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

A privacy-first Chrome extension that turns platform-provided video captions and complete linux.do topics into structured Markdown, then writes them to Obsidian without switching applications.

[下载最新版 / Download latest release](https://github.com/aibuqin-code/obsidian-multi-source-clipper/releases/latest)

## What it is for

This project is a focused capture layer for an Obsidian and AI-assisted learning workflow:

```text
platform evidence -> source-specific extraction -> structured Markdown -> Obsidian -> later AI processing
```

It currently has two source types:

- **Video transcript:** Bilibili, YouTube and available Xiaoe caption tracks.
- **Discussion thread:** complete linux.do topics, including floors and reply relationships.

It does not attempt to replace the official [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper). The official clipper remains the better general-purpose tool for arbitrary web pages, templates and page-level extraction. This extension is complementary: it uses source-specific interfaces when generic page extraction would miss caption tracks, unloaded discussion floors or reply structure.

## Features

### Video transcripts

- Bilibili AI/manual subtitle extraction.
- YouTube caption and transcript extraction.
- Experimental read-only detection of existing Xiaoe subtitle tracks.
- Smart language policy that keeps an English original as evidence and adds Chinese only as an auxiliary track when available.
- Single-speaker mode by default; optional two-person and multi-person context for later AI attribution.
- Optional timestamps, disabled by default.
- No full-video download and no local speech-recognition model.

### linux.do discussions

- Reads the topic JSON and fetches missing post IDs, so the page does not need to be scrolled to the bottom.
- Three capture scopes: main post, main post plus topic-author replies, or all floors.
- Preserves floor number, author, date, source link, topic-author marker and reply relationship.
- Preserves headings, links, remote images, quotes, fenced code, lists and tables.
- Keeps links to omitted reply targets when a narrower capture scope is selected.

### Shared workflow

- Copy Markdown, download `.md`, preview, or save through Obsidian Local REST API.
- True background writes with exact read-back verification; Obsidian does not take focus.
- Identical notes are not duplicated. Conflicting paths receive a numeric suffix instead of being overwritten.
- New notes use `processing_status: pending` and point to a source-specific processing rule.
- Settings and Local REST API credentials stay in Chrome local extension storage.

## Install

1. Download and extract the latest ZIP from [Releases](https://github.com/aibuqin-code/obsidian-multi-source-clipper/releases/latest).
2. Open `chrome://extensions/` and enable **Developer mode**.
3. Click **Load unpacked** and select the folder containing `manifest.json`.
4. Open **保存设置**, enter your own target folders and Local REST API details, then test the connection.

Do not move or delete the unpacked folder while Chrome is using it.

## True background saving

The normal `obsidian://` URI can activate Obsidian even with a `silent` parameter. This extension therefore uses the open-source [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin.

1. Install and enable Local REST API in Obsidian.
2. Enable its loopback HTTP server, normally `http://127.0.0.1:27123`.
3. Copy its API key into this extension's collapsed settings panel.
4. Click **测试后台连接** once.

Requests are restricted to `127.0.0.1` or `localhost`. The key is never added to notes, logs or release files.

## Supported behavior

| Source | Supported | Boundary |
| --- | --- | --- |
| Bilibili | Existing manual/AI subtitle tracks | No audio transcription when a track is absent |
| YouTube | Existing captions and transcript data | Preserves original-language evidence |
| Xiaoe | Existing TextTrack/VTT/JSON captions | No media download, ASR or access-control bypass |
| linux.do | Complete accessible topic and selected floors | Uses the current signed-in page session; no permission bypass |

## Markdown and AI processing

Video notes use `type: video-transcript` and [`video-transcript-v1`](docs/video-transcript-processing-rule.md). Discussion notes use `type: discussion-thread` and [`discussion-thread-v1`](docs/discussion-thread-processing-rule.md). Both begin as raw evidence with `processing_status: pending`.

The processing rules separate three actions:

- clean into a readable derivative without overwriting raw evidence;
- discuss the source without writing by default;
- distill a durable interpretation that links back to the source note.

## Privacy

See [PRIVACY.md](PRIVACY.md). Public source and release packages contain no personal Vault ID, API key, account, email, local path, browsing history, real transcript, private topic content or third-party token.

## Development

```bash
npm run check
npm test
```

The test suite covers source detection, transcript policies, linux.do scopes and reply links, Markdown metadata, loopback-only REST authentication, write/read-back verification and conflict handling.

## Limitations

- Platform UI and internal interfaces may change.
- Hardcoded subtitles burned into video frames require OCR and are not supported.
- Xiaoe support depends on whether the course publisher provides a readable caption track.
- linux.do extraction requires the current browser session to have access to the topic.
- Remote images remain remote links in the first release; attachment downloading is intentionally deferred.
- True background saving requires Obsidian to be running with Local REST API enabled.
- The extension does not bypass login, payment, access control or DRM.

## Credits and license

The linux.do adapter is based on the MIT-licensed userscript **linux.do 帖子保存到 Obsidian** by `zsq`. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the exact source and reuse boundary.

This project is MIT licensed. See [LICENSE](LICENSE).
