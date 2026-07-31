# Third-Party Notices

## linux.do 帖子保存到 Obsidian

- Author: `zsq`
- Version studied: `0.9.4`
- License: MIT
- Source: https://greasyfork.org/zh-CN/scripts/587200-linux-do-帖子保存到-obsidian

The linux.do adapter reuses and adapts the following ideas and implementation patterns from this userscript:

- reading `/t/{topic_id}.json`;
- fetching unloaded posts through `/t/{topic_id}/posts.json?post_ids[]=...` in bounded batches;
- the main / topic-author / all-floor scope model;
- Discourse cooked-HTML conversion for links, remote images, quotes, code blocks, lists and tables;
- floor metadata, topic-author marking and reply relationships.

The original floating page controls, attachment downloader, category mapping, like threshold, floor ranges, merge/overwrite modes and keyboard shortcut are not included in the first multi-source extension release.

The upstream userscript is MIT licensed. Its copyright notice is:

```text
Copyright (c) 2026 zsq
```

## Obsidian Web Clipper

- Project: https://github.com/obsidianmd/obsidian-clipper
- License: MIT

Obsidian Web Clipper was used as a capability and interaction benchmark. This project does not copy its general-purpose clipping implementation. It remains complementary to the official clipper by focusing on source-specific caption and discussion interfaces.
