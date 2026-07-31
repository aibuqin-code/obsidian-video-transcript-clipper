export const DISCUSSION_PROCESSING_RULE = Object.freeze({
  id: "discussion-thread-v1",
  note: "[[论坛帖子处理规则]]",
  url: "https://github.com/aibuqin-code/obsidian-multi-source-clipper/blob/main/docs/discussion-thread-processing-rule.md"
});

export const LINUXDO_SCOPES = Object.freeze({
  all: "全部楼层",
  author: "主帖 + 楼主回复",
  main: "只保存主帖"
});

function yamlString(value) {
  return JSON.stringify(String(value ?? "").replace(/\r?\n/g, " "));
}

function localDateTime(date) {
  const pad = value => String(value).padStart(2, "0");
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-")
    + "T"
    + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(":");
}

function sourceDate(value, fallback = new Date()) {
  const date = new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function safeSegment(value, fallback = "未命名帖子") {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 90);
  return cleaned || fallback;
}

function formatAuthor(post) {
  const username = post?.username || "unknown";
  const displayName = String(post?.displayName || "").trim();
  if (displayName && displayName.toLowerCase() !== username.toLowerCase()) {
    return `${displayName} (@${username})`;
  }
  return `@${username}`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date).replaceAll("/", "-");
}

export function linuxdoTopicId(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    return "";
  }
  if (!/(^|\.)linux\.do$/i.test(url.hostname)) return "";
  return url.pathname.match(/^\/t\/(?:[^/]+\/)?(\d+)(?:\/\d+)?\/?$/)?.[1] || "";
}

export function normalizeLinuxdoScope(value) {
  return Object.hasOwn(LINUXDO_SCOPES, value) ? value : "all";
}

export function selectLinuxdoPosts(posts, scope = "all") {
  const ordered = [...(Array.isArray(posts) ? posts : [])]
    .filter(post => post?.postNumber && post?.markdown)
    .sort((left, right) => left.postNumber - right.postNumber);
  if (ordered.length === 0) return [];
  const normalized = normalizeLinuxdoScope(scope);
  if (normalized === "main") return ordered.slice(0, 1);
  if (normalized === "author") {
    const topicAuthor = ordered[0].username;
    return ordered.filter(post => post.postNumber === 1 || post.username === topicAuthor);
  }
  return ordered;
}

export function buildDiscussionFilePath(payload, settings) {
  const folder = String(
    settings?.linuxdoTargetFolder || "Inbox/LinuxDo"
  ).replace(/^\/+|\/+$/g, "");
  const date = sourceDate(payload?.createdAt).toISOString().slice(0, 10);
  const title = safeSegment(payload?.title);
  const topicId = safeSegment(payload?.topicId || "", "").slice(0, 20);
  const suffix = topicId ? ` ${topicId}` : "";
  const filename = `${date} ${title}${suffix}.md`;
  return folder ? `${folder}/${filename}` : filename;
}

export function buildDiscussionMarkdown(payload, now = new Date(), options = {}) {
  const scope = normalizeLinuxdoScope(options.postScope || payload?.postScope);
  const posts = selectLinuxdoPosts(payload?.posts, scope);
  if (posts.length === 0) {
    throw new Error("没有拿到可保存的帖子正文，可能是主题权限不足。");
  }

  const firstPost = posts.find(post => post.postNumber === 1) || posts[0];
  const source = String(payload?.url || "");
  const topicAuthor = firstPost.username || payload?.author || "unknown";
  const totalPostCount = Number(payload?.totalPostCount) || posts.length;
  const capturedAt = localDateTime(now);
  const sourceTags = Array.isArray(payload?.tags)
    ? payload.tags.map(tag => typeof tag === "string" ? tag : tag?.name).filter(Boolean)
    : [];
  const tags = Array.from(new Set(["clip", "discussion-thread", "linux-do", "inbox", ...sourceTags]));
  const savedPostNumbers = new Set(posts.map(post => Number(post.postNumber)));

  const frontmatter = [
    "---",
    "type: discussion-thread",
    "status: raw",
    "processing_status: pending",
    "platform: linuxdo",
    `title: ${yamlString(payload?.title || "linux.do 帖子")}`,
    `source: ${yamlString(source)}`,
    `topic_id: ${yamlString(payload?.topicId || "")}`,
    `category: ${yamlString(payload?.category || "未分类")}`,
    `author: ${yamlString(topicAuthor)}`,
    `created_at: ${yamlString(payload?.createdAt || firstPost.createdAt || "")}`,
    `updated_at: ${yamlString(payload?.updatedAt || "")}`,
    `captured_at: ${yamlString(capturedAt)}`,
    `capture_scope: ${yamlString(scope)}`,
    `saved_post_count: ${posts.length}`,
    `total_post_count: ${totalPostCount}`,
    `processing_rule: ${yamlString(DISCUSSION_PROCESSING_RULE.id)}`,
    `processing_rule_note: ${yamlString(DISCUSSION_PROCESSING_RULE.note)}`,
    `tags: ${JSON.stringify(tags)}`,
    "---"
  ].join("\n");

  const sections = posts.map(post => {
    const isTopicAuthor = post.username === topicAuthor;
    const ownerMarker = isTopicAuthor ? " · 楼主" : "";
    const postUrl = post.url || `${source}/${post.postNumber}`;
    const replyTarget = Number(post.replyTo);
    const replyLine = replyTarget
      ? savedPostNumbers.has(replyTarget)
        ? `[↩ 回复 #${replyTarget} 楼](#post-${replyTarget}) · [查看原回复](${source}/${replyTarget})`
        : `↩ 回复 [#${replyTarget} 楼](${source}/${replyTarget})（该楼层未包含在本次范围内）`
      : "";
    const meta = [formatDateTime(post.createdAt), `[原帖链接](${postUrl})`]
      .filter(Boolean)
      .join(" · ");
    return [
      `<a id="post-${post.postNumber}"></a>`,
      `### #${post.postNumber} ${formatAuthor(post)}${ownerMarker}`,
      "",
      `_${meta}_`,
      replyLine ? `_${replyLine}_` : "",
      "",
      post.markdown || "_该楼层没有可保存的正文。_"
    ].filter((line, index, lines) => line || lines[index - 1] !== "").join("\n");
  });

  const info = [
    `- 原帖：${source ? `[${payload?.title || "linux.do 帖子"}](${source})` : payload?.title}`,
    `- 分类：${payload?.category || "未分类"}`,
    `- 楼主：@${topicAuthor}`,
    `- 创建：${formatDateTime(payload?.createdAt || firstPost.createdAt)}`,
    `- 范围：${LINUXDO_SCOPES[scope]}`,
    `- 保存楼层：${posts.length} / ${totalPostCount}`,
    `- 处理规则：${DISCUSSION_PROCESSING_RULE.note}`
  ].join("\n");

  return `${frontmatter}

# ${payload?.title || "linux.do 帖子"}

> [!warning] 证据边界
> 本稿来自 linux.do 主题接口，保留了所选范围内的楼层、作者、时间与回复关系。帖子可能在抓取后被编辑或删除；引用、链接和外部图片仍应回到原帖核对。

## 帖子信息

${info}

## 帖子内容

${sections.join("\n\n---\n\n")}
`;
}
