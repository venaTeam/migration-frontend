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

/**
 * Grafana folder URL on the rule's host, keeping a sub-path Grafana is served
 * under (e.g. /grafana). The bare UID when the rule has no http(s) URL.
 */
export function folderUrlFor(folderUid: string, ruleUrl: string | undefined): string {
  if (!ruleUrl || !isHttpUrl(ruleUrl)) return folderUid;
  const url = new URL(ruleUrl);
  const alerting = url.pathname.indexOf("/alerting/");
  const prefix = alerting > 0 ? url.pathname.slice(0, alerting) : "";
  return `${url.origin}${prefix}/dashboards/f/${encodeURIComponent(folderUid)}`;
}
