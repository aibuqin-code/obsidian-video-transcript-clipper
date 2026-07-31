(async function extractLinuxdoThread() {
  const options = {
    postScope: "all",
    ...(window.__OBSIDIAN_KNOWLEDGE_CLIPPER_OPTIONS__ || {})
  };
  const MAX_RETRIES = 3;
  const POSTS_PER_REQUEST = 20;
  const REQUEST_CONCURRENCY = 3;

  const topicId = location.pathname
    .match(/^\/t\/(?:[^/]+\/)?(\d+)(?:\/\d+)?\/?$/)?.[1];
  if (!topicId) {
    return { ok: false, error: "当前页面不是可读取的 linux.do 主题。" };
  }

  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

  async function fetchJson(path) {
    let lastError;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(path, {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal
        });
        if (response.ok) return await response.json();
        if (response.status !== 429 && response.status < 500) {
          throw new Error(`linux.do 请求失败：HTTP ${response.status}`);
        }
        lastError = new Error(`linux.do 暂时不可用：HTTP ${response.status}`);
        const retryAfter = Number(response.headers.get("Retry-After"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 800 * 2 ** attempt);
      } catch (error) {
        lastError = error;
        if (String(error?.message || "").startsWith("linux.do 请求失败")) throw error;
        if (attempt < MAX_RETRIES - 1) await sleep(800 * 2 ** attempt);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error(`抓取帖子失败：${lastError?.message || String(lastError)}`);
  }

  function chunks(items, size) {
    const output = [];
    for (let index = 0; index < items.length; index += size) {
      output.push(items.slice(index, index + size));
    }
    return output;
  }

  function absoluteUrl(value) {
    if (!value || /^(?:#|data:|mailto:|obsidian:)/i.test(value)) return value;
    try {
      return new URL(value, "https://linux.do").href;
    } catch {
      return value;
    }
  }

  function codeLanguage(language, value) {
    const normalized = String(language || "").toLowerCase();
    if (normalized && normalized !== "auto") return normalized;
    if (/\b(?:irm|invoke-restmethod)\b|\|\s*iex\b|\$env:/i.test(value)) return "powershell";
    if (/^\s*(?:#!.*\b(?:bash|sh)|(?:sudo\s+)?(?:bash|sh|curl|wget)\b)/im.test(value)) return "bash";
    const trimmed = value.trim();
    if (trimmed && /^[\[{]/.test(trimmed)) {
      try {
        JSON.parse(trimmed);
        return "json";
      } catch {
        // Keep unknown code as text.
      }
    }
    return "text";
  }

  function quoteMarkdown(markdown) {
    return String(markdown || "").split("\n")
      .map(line => line ? `> ${line}` : ">")
      .join("\n");
  }

  function htmlToMarkdown(cooked) {
    const container = document.createElement("div");
    container.innerHTML = cooked || "";
    container.querySelectorAll(
      "script, style, iframe, object, embed, form, button, .lightbox-wrapper .meta"
    ).forEach(node => node.remove());
    container.querySelectorAll("img.emoji").forEach(image => {
      image.replaceWith(document.createTextNode(image.getAttribute("alt") || ""));
    });
    container.querySelectorAll("a.anchor").forEach(anchor => anchor.remove());

    const codeBlocks = new Map();
    let codeIndex = 0;
    const renderChildren = element => Array.from(element.childNodes).map(renderNode).join("");

    function renderList(element, ordered) {
      return Array.from(element.children)
        .filter(child => child.tagName === "LI")
        .map((item, index) => {
          const nestedLists = Array.from(item.children)
            .filter(child => ["UL", "OL"].includes(child.tagName));
          const body = Array.from(item.childNodes)
            .filter(node => !nestedLists.includes(node))
            .map(renderNode).join("").trim().replace(/\n{2,}/g, "\n");
          const marker = ordered ? `${index + 1}. ` : "- ";
          const renderedBody = body.split("\n")
            .map((line, lineIndex) => lineIndex === 0 ? `${marker}${line}` : `  ${line}`)
            .join("\n");
          const renderedNested = nestedLists.map(nested => renderNode(nested).trim())
            .filter(Boolean)
            .map(nested => nested.split("\n").map(line => `  ${line}`).join("\n"))
            .join("\n");
          return [renderedBody, renderedNested].filter(Boolean).join("\n");
        }).join("\n") + "\n\n";
    }

    function renderTable(element) {
      const rows = Array.from(element.rows || []);
      if (!rows.length) return "";
      const values = rows.map(row => Array.from(row.cells).map(cell =>
        renderChildren(cell).trim().replace(/\|/g, "\\|").replace(/\s*\n+\s*/g, " / ")
      ));
      const width = Math.max(...values.map(row => row.length));
      const normalized = values.map(row => [
        ...row,
        ...Array.from({ length: width - row.length }, () => "")
      ]);
      return [
        `| ${normalized[0].join(" | ")} |`,
        `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
        ...normalized.slice(1).map(row => `| ${row.join(" | ")} |`),
        ""
      ].join("\n");
    }

    function renderNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return String(node.nodeValue || "").replace(/[\t\r\n ]+/g, " ");
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const element = node;
      const tag = element.tagName;
      const body = () => renderChildren(element).trim();
      if (tag === "BR") return "\n";
      if (/^H[1-6]$/.test(tag)) return `${"#".repeat(Math.min(Number(tag[1]) + 2, 6))} ${body()}\n\n`;
      if (["P", "DIV", "SECTION", "ARTICLE", "FIGURE", "FIGCAPTION"].includes(tag)) {
        const content = body();
        return content ? `${content}\n\n` : "";
      }
      if (["STRONG", "B"].includes(tag)) return `**${body()}**`;
      if (["EM", "I"].includes(tag)) return `*${body()}*`;
      if (["DEL", "S", "STRIKE"].includes(tag)) return `~~${body()}~~`;
      if (tag === "MARK") return `==${body()}==`;
      if (tag === "A") {
        const href = absoluteUrl(element.getAttribute("href") || "");
        const label = body() || href;
        return href ? `[${label}](${href})` : label;
      }
      if (tag === "IMG") {
        const source = element.getAttribute("data-orig-src")
          || element.getAttribute("data-large-uri")
          || element.getAttribute("data-src")
          || element.getAttribute("src");
        if (!source) return element.getAttribute("alt") || "";
        const alt = String(element.getAttribute("alt") || "图片").replace(/[\[\]]/g, "");
        return `![${alt}](<${absoluteUrl(source)}>)`;
      }
      if (["VIDEO", "AUDIO"].includes(tag)) {
        const source = element.getAttribute("src") || element.querySelector("source")?.getAttribute("src");
        return source ? `[${tag === "VIDEO" ? "视频" : "音频"}](${absoluteUrl(source)})` : "";
      }
      if (tag === "PRE") {
        const code = element.querySelector("code");
        const value = String(code?.textContent || element.textContent || "").replace(/^\n|\n$/g, "");
        const className = code?.className || element.className || "";
        const language = className.match(/(?:lang(?:uage)?-)([\w+-]+)/i)?.[1];
        const fenceSize = Math.max(3, ...Array.from(value.matchAll(/`+/g), match => match[0].length + 1));
        const fence = "`".repeat(fenceSize);
        const token = `LDO_CODE_BLOCK_${codeIndex}_PLACEHOLDER`;
        codeIndex += 1;
        codeBlocks.set(token, `${fence}${codeLanguage(language, value)}\n${value}\n${fence}`);
        return `\n\n${token}\n\n`;
      }
      if (tag === "CODE") {
        const value = element.textContent || "";
        const fence = "`".repeat(Math.max(1, ...Array.from(value.matchAll(/`+/g), match => match[0].length + 1)));
        return `${fence}${value}${fence}`;
      }
      if (tag === "ASIDE" && element.classList.contains("quote")) {
        const titleElement = element.querySelector(".quote-title__text-content a")
          || element.querySelector(".title a") || element.querySelector(".title");
        const title = String(titleElement?.textContent || "引用").replace(/\s+/g, " ").trim();
        const quoted = element.querySelector("blockquote");
        const content = quoted ? renderChildren(quoted).trim() : body();
        return `> [!quote] ${title}\n${quoteMarkdown(content)}\n`;
      }
      if (tag === "BLOCKQUOTE") return `${quoteMarkdown(body())}\n\n`;
      if (tag === "UL") return renderList(element, false);
      if (tag === "OL") return renderList(element, true);
      if (tag === "TABLE") return renderTable(element);
      if (tag === "HR") return "\n---\n\n";
      if (tag === "KBD") return `\`${element.textContent || ""}\``;
      return renderChildren(element);
    }

    let markdown = renderChildren(container)
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    for (const [token, codeBlock] of codeBlocks) markdown = markdown.replace(token, codeBlock);
    return markdown;
  }

  try {
    const topic = await fetchJson(`/t/${topicId}.json`);
    const loadedPosts = topic.post_stream?.posts || [];
    const postMap = new Map(loadedPosts.map(post => [post.id, post]));
    const stream = topic.post_stream?.stream || loadedPosts.map(post => post.id);
    const scope = ["main", "author", "all"].includes(options.postScope) ? options.postScope : "all";

    if (scope === "main") {
      const firstId = stream[0];
      if (firstId && !postMap.has(firstId)) {
        const result = await fetchJson(`/t/${topicId}/posts.json?post_ids%5B%5D=${encodeURIComponent(firstId)}`);
        for (const post of result.post_stream?.posts || []) postMap.set(post.id, post);
      }
    } else {
      const missing = chunks(stream.filter(id => !postMap.has(id)), POSTS_PER_REQUEST);
      let nextIndex = 0;
      async function worker() {
        while (nextIndex < missing.length) {
          const index = nextIndex;
          nextIndex += 1;
          const query = missing[index]
            .map(id => `post_ids%5B%5D=${encodeURIComponent(id)}`).join("&");
          const result = await fetchJson(`/t/${topicId}/posts.json?${query}`);
          for (const post of result.post_stream?.posts || []) postMap.set(post.id, post);
        }
      }
      await Promise.all(Array.from(
        { length: Math.min(REQUEST_CONCURRENCY, missing.length) },
        () => worker()
      ));
    }

    const allPosts = Array.from(postMap.values())
      .filter(post => post?.cooked && post.post_type === 1)
      .sort((left, right) => left.post_number - right.post_number);
    const topicAuthor = allPosts[0]?.username || "unknown";
    const selectedPosts = scope === "main"
      ? allPosts.slice(0, 1)
      : scope === "author"
        ? allPosts.filter(post => post.post_number === 1 || post.username === topicAuthor)
        : allPosts;

    let category = String(topic.category?.name || topic.category_name || "").trim();
    if (!category && topic.category_id) {
      try {
        const site = await fetchJson("/site.json");
        category = String(site.categories?.find(item => item.id === topic.category_id)?.name || "").trim();
      } catch {
        category = "";
      }
    }
    const source = `https://linux.do/t/${topic.slug || "topic"}/${topic.id}`;
    return {
      ok: true,
      kind: "discussion-thread",
      platform: "linuxdo",
      title: topic.title || document.title,
      url: source,
      topicId: String(topic.id || topicId),
      category: category || "未分类",
      author: topicAuthor,
      createdAt: topic.created_at || selectedPosts[0]?.created_at || "",
      updatedAt: topic.last_posted_at || "",
      totalPostCount: topic.posts_count || stream.length || selectedPosts.length,
      postScope: scope,
      tags: topic.tags || [],
      posts: selectedPosts.map(post => ({
        postNumber: Number(post.post_number),
        username: post.username || post.display_username || "unknown",
        displayName: post.name || "",
        createdAt: post.created_at || "",
        replyTo: Number(post.reply_to_post_number) || null,
        url: `${source}/${post.post_number}`,
        markdown: htmlToMarkdown(post.cooked)
      }))
    };
  } catch (error) {
    return {
      ok: false,
      error: `linux.do 帖子提取失败：${error?.message || String(error)}`
    };
  }
})();
