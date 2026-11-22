// Links into the app: ?rule_url=<Grafana rule URL> (repeatable) or ?folder_url=<Grafana folder URL>.

export type DeepLinkTarget =
  | { kind: "rule"; url: string }
  | { kind: "rules"; urls: string[] }
  | { kind: "folder"; url: string };

export type DeepLinkParse =
  | { status: "none" }
  | { status: "ok"; target: DeepLinkTarget }
  | { status: "invalid"; message: string };

/** Most rules one link may open; matches the backend's load-list limit. */
export const MAX_LINK_RULES = 50;

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
  const ruleUrls = [...new Set(nonEmpty(params.getAll(RULE_PARAM)))];
  const folderUrls = nonEmpty(params.getAll(FOLDER_PARAM));

  if (ruleUrls.length > MAX_LINK_RULES) {
    return {
      status: "invalid",
      message: `This link opens ${ruleUrls.length} rules; at most ${MAX_LINK_RULES} can be opened at once.`,
    };
  }
  if (ruleUrls.length > 0) {
    if (!ruleUrls.every(isHttpUrl)) {
      return {
        status: "invalid",
        message: "The rule link isn't a valid http(s) URL. Paste the rule URL instead.",
      };
    }
    return ruleUrls.length === 1
      ? { status: "ok", target: { kind: "rule", url: ruleUrls[0] } }
      : { status: "ok", target: { kind: "rules", urls: ruleUrls } };
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
  if (target?.kind === "rule") url.searchParams.set(RULE_PARAM, target.url);
  if (target?.kind === "rules") target.urls.forEach((u) => url.searchParams.append(RULE_PARAM, u));
  if (target?.kind === "folder") url.searchParams.set(FOLDER_PARAM, target.url);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Grafana folder URL on the rule's host; the bare UID when the rule has no http(s) URL. */
export function folderUrlFor(folderUid: string, ruleUrl: string | undefined): string {
  if (!ruleUrl || !isHttpUrl(ruleUrl)) return folderUid;
  return `${new URL(ruleUrl).origin}/dashboards/f/${encodeURIComponent(folderUid)}`;
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
    const value = JSON.parse(raw) as { kind?: unknown; url?: unknown; urls?: unknown };
    if ((value.kind === "rule" || value.kind === "folder") && typeof value.url === "string" && isHttpUrl(value.url)) {
      return { kind: value.kind, url: value.url };
    }
    if (
      value.kind === "rules" &&
      Array.isArray(value.urls) &&
      value.urls.length > 0 &&
      value.urls.every((u) => typeof u === "string" && isHttpUrl(u))
    ) {
      return { kind: "rules", urls: value.urls as string[] };
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
