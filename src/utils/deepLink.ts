// Links into the app: ?rule_url=<Grafana rule URL> or ?folder_url=<Grafana folder URL>.

export type DeepLinkTarget = { kind: "rule"; url: string } | { kind: "folder"; url: string };

export type DeepLinkParse =
  | { status: "none" }
  | { status: "ok"; target: DeepLinkTarget }
  | { status: "invalid"; message: string };

const RULE_PARAM = "rule_url";
const FOLDER_PARAM = "folder_url";
const STASH_KEY = "migration.deepLinkTarget";

export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function nonEmpty(values: string[]): string[] {
  return values.map((v) => v.trim()).filter(Boolean);
}

export function parseDeepLink(search: string): DeepLinkParse {
  const params = new URLSearchParams(search);
  const ruleUrls = nonEmpty(params.getAll(RULE_PARAM));
  const folderUrls = nonEmpty(params.getAll(FOLDER_PARAM));

  if (ruleUrls.length > 1) {
    return {
      status: "invalid",
      message: "This link opens several rules at once, which isn't supported yet. Paste one rule URL instead.",
    };
  }
  if (ruleUrls.length === 1) {
    if (!isHttpUrl(ruleUrls[0])) {
      return {
        status: "invalid",
        message: "The rule link isn't a valid http(s) URL. Paste the rule URL instead.",
      };
    }
    return { status: "ok", target: { kind: "rule", url: ruleUrls[0] } };
  }
  if (folderUrls.length > 0) {
    if (!isHttpUrl(folderUrls[0])) {
      return {
        status: "invalid",
        message: "The folder link isn't a valid http(s) URL. Paste the folder URL instead.",
      };
    }
    return { status: "ok", target: { kind: "folder", url: folderUrls[0] } };
  }
  return { status: "none" };
}

/** Relative href (path + query + hash) with the link params set to `target`, or removed. */
export function hrefWithTarget(href: string, target: DeepLinkTarget | null): string {
  const url = new URL(href);
  url.searchParams.delete(RULE_PARAM);
  url.searchParams.delete(FOLDER_PARAM);
  if (target) {
    url.searchParams.set(target.kind === "rule" ? RULE_PARAM : FOLDER_PARAM, target.url);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function stashTarget(target: DeepLinkTarget, storage: Storage | null = sessionStore()): void {
  try {
    storage?.setItem(STASH_KEY, JSON.stringify(target));
  } catch {
    // Storage blocked: the URL still carries the target.
  }
}

export function readStashedTarget(storage: Storage | null = sessionStore()): DeepLinkTarget | null {
  try {
    const raw = storage?.getItem(STASH_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { kind?: unknown; url?: unknown };
    if ((value.kind === "rule" || value.kind === "folder") && typeof value.url === "string" && isHttpUrl(value.url)) {
      return { kind: value.kind, url: value.url };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearStashedTarget(storage: Storage | null = sessionStore()): void {
  try {
    storage?.removeItem(STASH_KEY);
  } catch {
    // Nothing to clear.
  }
}
