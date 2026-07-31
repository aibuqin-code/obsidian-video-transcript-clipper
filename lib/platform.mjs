const PLATFORM_RULES = [
  {
    id: "bilibili",
    label: "B站",
    script: "content-bilibili.js",
    matches: url => url.hostname === "www.bilibili.com"
      && url.pathname.includes("/video/")
  },
  {
    id: "youtube",
    label: "YouTube",
    script: "content-youtube.js",
    matches: url => /(^|\.)youtube\.com$/i.test(url.hostname)
      && (url.pathname === "/watch" || url.pathname.startsWith("/shorts/"))
  },
  {
    id: "xiaoe",
    label: "小鹅通",
    script: "content-xiaoe.js",
    matches: url => [
      "xiaoe-tech.com",
      "xiaoeknow.com",
      "xiaoecloud.com",
      "xet.pomoho.com",
      "xet.tech",
      "xet-pc.citv.cn"
    ].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
  },
  {
    id: "linuxdo",
    label: "linux.do",
    script: "content-linuxdo.js",
    kind: "discussion-thread",
    matches: url => /(^|\.)linux\.do$/i.test(url.hostname)
      && /^\/t\/(?:[^/]+\/)?\d+(?:\/\d+)?\/?$/.test(url.pathname)
  }
];

export function detectPlatform(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    return null;
  }

  return PLATFORM_RULES.find(rule => rule.matches(url)) || null;
}

export function platformLabel(platform) {
  return PLATFORM_RULES.find(rule => rule.id === platform)?.label || "内容";
}

export function supportedPlatformSummary() {
  return PLATFORM_RULES.map(({ id, label }) => ({ id, label }));
}
