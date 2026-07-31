import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDiscussionFilePath,
  buildDiscussionMarkdown,
  linuxdoTopicId,
  normalizeLinuxdoScope,
  selectLinuxdoPosts
} from "../lib/linuxdo.mjs";
import { detectPlatform } from "../lib/platform.mjs";

const posts = [
  {
    postNumber: 3,
    username: "visitor",
    displayName: "访客",
    createdAt: "2026-07-30T03:00:00Z",
    replyTo: 1,
    url: "https://linux.do/t/example/123/3",
    markdown: "回复正文"
  },
  {
    postNumber: 1,
    username: "author",
    displayName: "作者",
    createdAt: "2026-07-30T01:00:00Z",
    replyTo: null,
    url: "https://linux.do/t/example/123/1",
    markdown: "主帖正文\n\n```js\nconsole.log('ok')\n```"
  },
  {
    postNumber: 2,
    username: "author",
    displayName: "作者",
    createdAt: "2026-07-30T02:00:00Z",
    replyTo: 3,
    url: "https://linux.do/t/example/123/2",
    markdown: "> [!quote] 引用\n> 原话"
  }
];

const payload = {
  kind: "discussion-thread",
  platform: "linuxdo",
  title: "示例：完整主题",
  url: "https://linux.do/t/example/123",
  topicId: "123",
  category: "开发调优",
  author: "author",
  createdAt: "2026-07-30T01:00:00Z",
  updatedAt: "2026-07-30T03:00:00Z",
  totalPostCount: 3,
  tags: ["javascript"],
  posts
};

test("只把 linux.do 主题页识别为讨论适配器", () => {
  assert.equal(linuxdoTopicId("https://linux.do/t/example/123/4"), "123");
  assert.equal(linuxdoTopicId("https://linux.do/latest"), "");
  assert.equal(detectPlatform("https://linux.do/t/example/123")?.id, "linuxdo");
  assert.equal(detectPlatform("https://linux.do/latest"), null);
});

test("linux.do 三种范围保持楼层顺序并正确筛选楼主", () => {
  assert.equal(normalizeLinuxdoScope("invalid"), "all");
  assert.deepEqual(selectLinuxdoPosts(posts, "main").map(post => post.postNumber), [1]);
  assert.deepEqual(selectLinuxdoPosts(posts, "author").map(post => post.postNumber), [1, 2]);
  assert.deepEqual(selectLinuxdoPosts(posts, "all").map(post => post.postNumber), [1, 2, 3]);
});

test("讨论 Markdown 带 pending 协议、楼主标记与可跳转回复关系", () => {
  const markdown = buildDiscussionMarkdown(
    payload,
    new Date(2026, 6, 31, 12, 30, 0),
    { postScope: "all" }
  );
  assert.match(markdown, /type: discussion-thread/);
  assert.match(markdown, /processing_status: pending/);
  assert.match(markdown, /processing_rule: "discussion-thread-v1"/);
  assert.match(markdown, /capture_scope: "all"/);
  assert.match(markdown, /saved_post_count: 3/);
  assert.match(markdown, /### #1 作者 \(@author\) · 楼主/);
  assert.match(markdown, /<a id="post-3"><\/a>/);
  assert.match(markdown, /\[↩ 回复 #3 楼\]\(#post-3\)/);
  assert.match(markdown, /```js/);
  assert.match(markdown, /> \[!quote\] 引用/);
  assert.match(markdown, /tags: \["clip","discussion-thread","linux-do","inbox","javascript"\]/);
});

test("主帖加楼主回复模式不混入其他作者楼层", () => {
  const markdown = buildDiscussionMarkdown(payload, new Date(), { postScope: "author" });
  assert.match(markdown, /capture_scope: "author"/);
  assert.match(markdown, /saved_post_count: 2/);
  assert.match(markdown, /### #2/);
  assert.match(markdown, /该楼层未包含在本次范围内/);
  assert.doesNotMatch(markdown, /\[↩ 回复 #3 楼\]\(#post-3\)/);
  assert.doesNotMatch(markdown, /### #3/);
});

test("linux.do 文件路径使用主题创建日期并清理非法字符", () => {
  assert.equal(
    buildDiscussionFilePath(payload, { linuxdoTargetFolder: "Inbox/LinuxDo" }),
    "Inbox/LinuxDo/2026-07-30 示例：完整主题 123.md"
  );
});
