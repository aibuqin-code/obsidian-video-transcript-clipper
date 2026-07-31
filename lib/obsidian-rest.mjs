export const DEFAULT_OBSIDIAN_REST_URL = "http://127.0.0.1:27123";

export class ObsidianRestError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "ObsidianRestError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function normalizeObsidianRestUrl(value) {
  const raw = String(value || DEFAULT_OBSIDIAN_REST_URL).trim().replace(/\/+$/g, "");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ObsidianRestError("Obsidian API 地址格式不正确。", "invalid-api-url");
  }

  const isLoopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (!isLoopback || !["http:", "https:"].includes(url.protocol)) {
    throw new ObsidianRestError(
      "为保护隐私，后台保存只允许连接本机 127.0.0.1 或 localhost。",
      "non-loopback-api-url"
    );
  }
  return url.toString().replace(/\/$/g, "");
}

export function encodeVaultPath(filePath) {
  const normalized = String(filePath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    throw new ObsidianRestError("保存路径不能为空。", "empty-file-path");
  }
  if (normalized.split("/").some(part => !part || part === "." || part === "..")) {
    throw new ObsidianRestError("保存路径包含不安全的目录片段。", "unsafe-file-path");
  }
  return normalized.split("/").map(encodeURIComponent).join("/");
}

function authHeaders(apiKey, extra = {}) {
  const key = String(apiKey || "").trim();
  if (!key) {
    throw new ObsidianRestError(
      "请先在保存设置中填写 Local REST API Key。",
      "missing-api-key"
    );
  }
  return {
    Authorization: `Bearer ${key}`,
    ...extra
  };
}

function friendlyNetworkError(error) {
  if (error instanceof ObsidianRestError) return error;
  return new ObsidianRestError(
    "没有连接到 Obsidian 后台。请保持 Obsidian 打开，并启用 Local REST API 插件的 HTTP 服务。",
    "api-unreachable",
    { cause: error }
  );
}

async function request(fetchImpl, url, options) {
  try {
    return await fetchImpl(url, options);
  } catch (error) {
    throw friendlyNetworkError(error);
  }
}

async function responseError(response, action) {
  if ([401, 403].includes(response.status)) {
    return new ObsidianRestError(
      "Obsidian API Key 无效，请重新复制 Local REST API 设置中的密钥。",
      "api-unauthorized",
      { status: response.status }
    );
  }
  const body = await response.text().catch(() => "");
  const detail = body.trim().slice(0, 180);
  return new ObsidianRestError(
    `${action}失败（HTTP ${response.status}）${detail ? `：${detail}` : ""}`,
    "api-response-error",
    { status: response.status }
  );
}

function suffixedPath(filePath, index) {
  const match = String(filePath).match(/^(.*?)(\.md)?$/i);
  return `${match[1]} ${index}${match[2] || ""}`;
}

function vaultUrl(baseUrl, filePath) {
  return `${normalizeObsidianRestUrl(baseUrl)}/vault/${encodeVaultPath(filePath)}`;
}

async function readPath({ fetchImpl, baseUrl, apiKey, filePath }) {
  const response = await request(fetchImpl, vaultUrl(baseUrl, filePath), {
    method: "GET",
    headers: authHeaders(apiKey),
    cache: "no-store"
  });
  if (response.status === 404) return { exists: false, content: "" };
  if (!response.ok) throw await responseError(response, "检查目标文件");
  return { exists: true, content: await response.text() };
}

export async function testObsidianRestConnection(settings, fetchImpl = fetch) {
  const baseUrl = normalizeObsidianRestUrl(settings?.restApiUrl);
  const response = await request(fetchImpl, `${baseUrl}/vault/`, {
    method: "GET",
    headers: authHeaders(settings?.restApiKey),
    cache: "no-store"
  });
  if (!response.ok) throw await responseError(response, "连接 Obsidian");
  return { ok: true, baseUrl };
}

export async function saveMarkdownViaRest({
  filePath,
  markdown,
  restApiUrl,
  restApiKey
}, fetchImpl = fetch) {
  const source = String(markdown ?? "");
  if (!source) {
    throw new ObsidianRestError("没有可保存的 Markdown 内容。", "empty-markdown");
  }

  const baseUrl = normalizeObsidianRestUrl(restApiUrl);
  let resolvedPath = String(filePath || "");
  let existing = await readPath({
    fetchImpl,
    baseUrl,
    apiKey: restApiKey,
    filePath: resolvedPath
  });

  if (existing.exists && existing.content === source) {
    return { status: "unchanged", filePath: resolvedPath };
  }

  if (existing.exists) {
    let found = false;
    for (let index = 1; index <= 100; index += 1) {
      const candidate = suffixedPath(filePath, index);
      existing = await readPath({
        fetchImpl,
        baseUrl,
        apiKey: restApiKey,
        filePath: candidate
      });
      if (!existing.exists) {
        resolvedPath = candidate;
        found = true;
        break;
      }
      if (existing.content === source) {
        return { status: "unchanged", filePath: candidate };
      }
    }
    if (!found) {
      throw new ObsidianRestError(
        "同名逐字稿过多，未继续写入。请调整保存目录或文件名。",
        "too-many-conflicts"
      );
    }
  }

  const response = await request(fetchImpl, vaultUrl(baseUrl, resolvedPath), {
    method: "PUT",
    headers: authHeaders(restApiKey, {
      "Content-Type": "text/markdown; charset=utf-8"
    }),
    body: source
  });
  if (!response.ok) throw await responseError(response, "写入 Obsidian");

  const verified = await readPath({
    fetchImpl,
    baseUrl,
    apiKey: restApiKey,
    filePath: resolvedPath
  });
  if (!verified.exists || verified.content !== source) {
    throw new ObsidianRestError(
      "Obsidian 返回了成功，但回读内容不一致；为避免误报，本次按保存失败处理。",
      "readback-mismatch"
    );
  }

  return {
    status: resolvedPath === filePath ? "created" : "created-with-suffix",
    filePath: resolvedPath
  };
}
