import { describe, expect, it } from "vitest";
import {
  clearStashedTarget,
  hrefWithTarget,
  isHttpUrl,
  parseDeepLink,
  readStashedTarget,
  stashTarget,
} from "./deepLink";

const RULE = "https://grafana.example/alerting/grafana/abc123/view";
const FOLDER = "https://grafana.example/dashboards/f/fold1/team";

function search(params: Record<string, string | string[]>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : [value]) sp.append(key, v);
  }
  return `?${sp.toString()}`;
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

describe("isHttpUrl", () => {
  it("accepts http and https", () => {
    expect(isHttpUrl(RULE)).toBe(true);
    expect(isHttpUrl("http://grafana/alerting/grafana/x/view")).toBe(true);
  });

  it("rejects other schemes, bare UIDs and garbage", () => {
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("ftp://grafana/x")).toBe(false);
    expect(isHttpUrl("abc123")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

describe("parseDeepLink", () => {
  it("returns none without link params", () => {
    expect(parseDeepLink("")).toEqual({ status: "none" });
    expect(parseDeepLink("?foo=bar")).toEqual({ status: "none" });
    expect(parseDeepLink(search({ rule_url: "  " }))).toEqual({ status: "none" });
  });

  it("reads a rule link", () => {
    expect(parseDeepLink(search({ rule_url: RULE }))).toEqual({
      status: "ok",
      target: { kind: "rule", url: RULE },
    });
  });

  it("reads a folder link", () => {
    expect(parseDeepLink(search({ folder_url: FOLDER }))).toEqual({
      status: "ok",
      target: { kind: "folder", url: FOLDER },
    });
  });

  it("trims whitespace around the URL", () => {
    expect(parseDeepLink(search({ rule_url: `  ${RULE} ` }))).toEqual({
      status: "ok",
      target: { kind: "rule", url: RULE },
    });
  });

  it("prefers rule_url when both are present", () => {
    expect(parseDeepLink(search({ rule_url: RULE, folder_url: FOLDER }))).toEqual({
      status: "ok",
      target: { kind: "rule", url: RULE },
    });
  });

  it("rejects a non-http(s) rule URL", () => {
    const result = parseDeepLink(search({ rule_url: "javascript:alert(1)" }));
    expect(result.status).toBe("invalid");
  });

  it("rejects a non-http(s) folder URL", () => {
    const result = parseDeepLink(search({ folder_url: "not a url" }));
    expect(result.status).toBe("invalid");
  });

  it("rejects several rule URLs until the list endpoint exists", () => {
    const result = parseDeepLink(search({ rule_url: [RULE, `${RULE}2`] }));
    expect(result.status).toBe("invalid");
  });
});

describe("hrefWithTarget", () => {
  const base = "https://migration.example/app?keep=1#top";

  it("sets rule_url and keeps other params and the hash", () => {
    const href = hrefWithTarget(base, { kind: "rule", url: RULE });
    const url = new URL(href, "https://migration.example");
    expect(url.pathname).toBe("/app");
    expect(url.searchParams.get("keep")).toBe("1");
    expect(url.searchParams.get("rule_url")).toBe(RULE);
    expect(url.searchParams.has("folder_url")).toBe(false);
    expect(url.hash).toBe("#top");
  });

  it("replaces a rule link with a folder link", () => {
    const withRule = hrefWithTarget(base, { kind: "rule", url: RULE });
    const href = hrefWithTarget(new URL(withRule, base).href, { kind: "folder", url: FOLDER });
    const url = new URL(href, base);
    expect(url.searchParams.has("rule_url")).toBe(false);
    expect(url.searchParams.get("folder_url")).toBe(FOLDER);
  });

  it("removes both link params when the target is null", () => {
    const href = hrefWithTarget(
      `https://migration.example/?rule_url=${encodeURIComponent(RULE)}&rule_url=x&folder_url=y&keep=1`,
      null
    );
    expect(href).toBe("/?keep=1");
  });

  it("round-trips through parseDeepLink", () => {
    const href = hrefWithTarget(base, { kind: "rule", url: RULE });
    const url = new URL(href, base);
    expect(parseDeepLink(url.search)).toEqual({
      status: "ok",
      target: { kind: "rule", url: RULE },
    });
  });
});

describe("stash", () => {
  it("stores, reads and clears a target", () => {
    const storage = memoryStorage();
    expect(readStashedTarget(storage)).toBeNull();
    stashTarget({ kind: "folder", url: FOLDER }, storage);
    expect(readStashedTarget(storage)).toEqual({ kind: "folder", url: FOLDER });
    clearStashedTarget(storage);
    expect(readStashedTarget(storage)).toBeNull();
  });

  it("ignores corrupt or unsafe stored values", () => {
    const storage = memoryStorage();
    storage.setItem("migration.deepLinkTarget", "{not json");
    expect(readStashedTarget(storage)).toBeNull();
    storage.setItem(
      "migration.deepLinkTarget",
      JSON.stringify({ kind: "rule", url: "javascript:alert(1)" })
    );
    expect(readStashedTarget(storage)).toBeNull();
    storage.setItem("migration.deepLinkTarget", JSON.stringify({ kind: "other", url: RULE }));
    expect(readStashedTarget(storage)).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(() => stashTarget({ kind: "rule", url: RULE }, broken)).not.toThrow();
    expect(readStashedTarget(broken)).toBeNull();
    expect(() => clearStashedTarget(broken)).not.toThrow();
    expect(readStashedTarget(null)).toBeNull();
  });
});
