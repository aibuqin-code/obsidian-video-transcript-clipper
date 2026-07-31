import assert from "node:assert/strict";
import test from "node:test";

import {
  encodeVaultPath,
  normalizeObsidianRestUrl,
  saveMarkdownViaRest,
  testObsidianRestConnection
} from "../lib/obsidian-rest.mjs";

function response(status, body = "") {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => String(body)
  };
}

function createVaultFetch(initial = {}) {
  const files = new Map(Object.entries(initial));
  const calls = [];

  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (options.headers?.Authorization !== "Bearer test-key") {
      return response(401, "Unauthorized");
    }
    const parsed = new URL(url);
    if (parsed.pathname === "/vault/") return response(200, "[]");
    const prefix = "/vault/";
    const filePath = parsed.pathname
      .slice(prefix.length)
      .split("/")
      .map(decodeURIComponent)
      .join("/");

    if (options.method === "GET") {
      return files.has(filePath)
        ? response(200, files.get(filePath))
        : response(404, "Not found");
    }
    if (options.method === "PUT") {
      files.set(filePath, String(options.body));
      return response(204);
    }
    return response(405, "Method not allowed");
  };

  return { fetchImpl, files, calls };
}

test("Obsidian REST 地址只允许本机回环接口", () => {
  assert.equal(normalizeObsidianRestUrl("http://127.0.0.1:27123/"), "http://127.0.0.1:27123");
  assert.equal(normalizeObsidianRestUrl("http://localhost:27123"), "http://localhost:27123");
  assert.throws(
    () => normalizeObsidianRestUrl("https://example.com/api"),
    /只允许连接本机/
  );
});

test("Vault 路径逐段编码并拒绝父目录跳转", () => {
  assert.equal(
    encodeVaultPath("Inbox/视频逐字稿/示例 课程.md"),
    "Inbox/%E8%A7%86%E9%A2%91%E9%80%90%E5%AD%97%E7%A8%BF/%E7%A4%BA%E4%BE%8B%20%E8%AF%BE%E7%A8%8B.md"
  );
  assert.throws(() => encodeVaultPath("Inbox/../secret.md"), /不安全/);
});

test("连接测试携带本地 Bearer Key", async () => {
  const { fetchImpl, calls } = createVaultFetch();
  const result = await testObsidianRestConnection({
    restApiUrl: "http://127.0.0.1:27123",
    restApiKey: "test-key"
  }, fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-key");
});

test("静默保存会写入后回读验证", async () => {
  const { fetchImpl, files, calls } = createVaultFetch();
  const result = await saveMarkdownViaRest({
    filePath: "Inbox/示例课程.md",
    markdown: "# 示例\n",
    restApiUrl: "http://127.0.0.1:27123",
    restApiKey: "test-key"
  }, fetchImpl);

  assert.deepEqual(result, { status: "created", filePath: "Inbox/示例课程.md" });
  assert.equal(files.get("Inbox/示例课程.md"), "# 示例\n");
  assert.deepEqual(calls.map(call => call.options.method), ["GET", "PUT", "GET"]);
});

test("内容完全相同时不重复写入", async () => {
  const { fetchImpl, calls } = createVaultFetch({
    "Inbox/示例课程.md": "# 示例\n"
  });
  const result = await saveMarkdownViaRest({
    filePath: "Inbox/示例课程.md",
    markdown: "# 示例\n",
    restApiUrl: "http://127.0.0.1:27123",
    restApiKey: "test-key"
  }, fetchImpl);

  assert.deepEqual(result, { status: "unchanged", filePath: "Inbox/示例课程.md" });
  assert.deepEqual(calls.map(call => call.options.method), ["GET"]);
});

test("同名但内容不同时自动另存，不覆盖原稿", async () => {
  const { fetchImpl, files } = createVaultFetch({
    "Inbox/示例课程.md": "旧内容",
    "Inbox/示例课程 1.md": "另一个旧内容"
  });
  const result = await saveMarkdownViaRest({
    filePath: "Inbox/示例课程.md",
    markdown: "新内容",
    restApiUrl: "http://127.0.0.1:27123",
    restApiKey: "test-key"
  }, fetchImpl);

  assert.deepEqual(result, {
    status: "created-with-suffix",
    filePath: "Inbox/示例课程 2.md"
  });
  assert.equal(files.get("Inbox/示例课程.md"), "旧内容");
  assert.equal(files.get("Inbox/示例课程 2.md"), "新内容");
});

test("无效 Key 与服务未启动时给出可操作错误", async () => {
  const { fetchImpl } = createVaultFetch();
  await assert.rejects(
    saveMarkdownViaRest({
      filePath: "Inbox/示例.md",
      markdown: "内容",
      restApiUrl: "http://127.0.0.1:27123",
      restApiKey: "wrong-key"
    }, fetchImpl),
    /API Key 无效/
  );

  await assert.rejects(
    testObsidianRestConnection({
      restApiUrl: "http://127.0.0.1:27123",
      restApiKey: "test-key"
    }, async () => { throw new TypeError("fetch failed"); }),
    /没有连接到 Obsidian 后台/
  );
});
