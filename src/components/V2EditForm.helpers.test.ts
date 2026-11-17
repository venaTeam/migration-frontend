import { describe, expect, it } from "vitest";
import type { FieldConstraints, StandardField } from "../types";
import { buildPayload, validate } from "./V2EditForm";

function field(overrides: Partial<StandardField> & { name: string }): StandardField {
  return {
    location: "label",
    required: false,
    explanation: "",
    constraints: {} as FieldConstraints,
    default_value: null,
    ...overrides,
  };
}

const fields: StandardField[] = [
  field({ name: "site", location: "label", required: true }),
  field({
    name: "severity",
    location: "label",
    constraints: { allowed_values: ["warning", "critical"] },
  }),
  field({ name: "summary", location: "annotation", required: true }),
  field({ name: "runbook", location: "annotation" }),
  field({ name: "Appchi-$operator", location: "label" }),
  field({ name: "Send-Alert", location: "label" }),
];

describe("v2 edit validate", () => {
  it("requires required fields and checks allowed_values", () => {
    const errors = validate({ site: "", summary: "s", severity: "bogus" }, fields);
    expect(errors.join("; ")).toMatch(/site is required/);
    expect(errors.join("; ")).toMatch(/severity must be one of/);
  });

  it("ignores Send-Alert entirely (it is forced server-side of the form)", () => {
    const errors = validate({ site: "il01", summary: "s", "Send-Alert": "" }, fields);
    expect(errors).toEqual([]);
  });

  it("does not require optional annotation fields", () => {
    const errors = validate({ site: "il01", summary: "s" }, fields);
    expect(errors).toEqual([]);
  });
});

describe("v2 edit buildPayload", () => {
  it("includes extra labels/annotations (non-schema keys ride along)", () => {
    const payload = buildPayload(
      { site: "il01", summary: "down", "Appchi-$operator": "Appchi - Znif" },
      fields,
      "rule title",
      { "Appchi - Znif": "true" },
      { team: "noct" },
      { legacy_note: "keep me" }
    );
    expect(payload.labels.team).toBe("noct");
    expect(payload.annotations.legacy_note).toBe("keep me");
    expect(payload.labels["Appchi - Znif"]).toBe("true");
  });

  it("forces Send-Alert true and maps locations correctly", () => {
    const payload = buildPayload(
      { site: "il01", summary: "down", runbook: "RB-1", "Appchi-$operator": "Appchi - Znif" },
      fields,
      "t",
      { "Appchi - Znif": "true" },
      {},
      {}
    );
    expect(payload.labels["Send-Alert"]).toBe("true");
    expect(payload.labels.site).toBe("il01");
    expect(payload.annotations.summary).toBe("down");
    expect(payload.annotations.runbook).toBe("RB-1");
  });

  it("clears schema annotation fields the user emptied", () => {
    const payload = buildPayload(
      { site: "il01", summary: "down", runbook: "", "Appchi-$operator": "Appchi - Znif" },
      fields,
      "t",
      { runbook: "was set" },
      {},
      { runbook: "was set", legacy: "keep" }
    );
    // runbook emptied → remove from the rule (the pre-existing value must not
    // be merged back), but non-schema "legacy" must survive untouched.
    expect(payload.clearAnnotations).toContain("runbook");
    expect(payload.clearAnnotations).not.toContain("legacy");
    expect(payload.annotations.legacy).toBe("keep");
    expect(payload.annotations).not.toHaveProperty("runbook");
  });

  it("requests removal of the previous operator label key when changed", () => {
    // loadedLabels mirrors loadV2EditTarget: it still carries the rule's
    // current operator key; extraLabels deliberately excludes it.
    const payload = buildPayload(
      { site: "il01", summary: "down", severity: "warning", "Appchi-$operator": "Appchi - New" },
      fields,
      "t",
      { "Appchi - Old": "true", site: "il01", severity: "high" },
      {},
      {}
    );
    expect(payload.labels["Appchi - New"]).toBe("true");
    expect(payload.labels["Appchi - Old"]).toBeUndefined();
    expect(payload.clearLabels).toEqual(["Appchi - Old"]);
  });

  it("keeps clearLabels empty when the operator was not changed", () => {
    const payload = buildPayload(
      { site: "il01", summary: "down", severity: "warning", "Appchi-$operator": "Appchi - Znif" },
      fields,
      "t",
      { "Appchi - Znif": "true", site: "il01", severity: "warning" },
      {},
      {}
    );
    expect(payload.clearLabels).toEqual([]);
  });

  it("requests removal of emptied optional schema labels via clearLabels", () => {
    const payload = buildPayload(
      { site: "il01", summary: "down", severity: "", "Appchi-$operator": "Appchi - Znif" },
      fields,
      "t",
      { severity: "high", "Appchi - Znif": "true" },
      {},
      {}
    );
    expect(payload.clearLabels).toContain("severity");
    // The emptied value must not be merged back through the payload either.
    expect(payload.labels).not.toHaveProperty("severity");
  });

  // Regression for the two-consecutive-saves orphan-label bug: save #1
  // (Znif → Boaz) clears "Appchi - Znif"; save #2 in the SAME walkthrough
  // (Boaz → Casim) must derive loadedOperatorKey from the rule's labels as
  // re-fetched after save #1 — i.e. "Appchi - Boaz", not the stale
  // "Appchi - Znif". With a stale key, clearLabels no-ops and BOTH
  // "Appchi - Boaz" and "Appchi - Casim" persist on the rule, and the
  // compliance engine resolves the operator from the FIRST "Appchi - " key.
  it("second save in one session clears the FIRST save's new key, not the original", () => {
    // Save #1: Znif → Boaz.
    const first = buildPayload(
      { site: "il01", summary: "down", severity: "warning", "Appchi-$operator": "Appchi - Boaz" },
      fields,
      "t",
      { site: "il01", severity: "warning", "Appchi - Znif": "true" },
      {},
      {}
    );
    expect(first.clearLabels).toEqual(["Appchi - Znif"]);
    expect(first.labels["Appchi - Boaz"]).toBe("true");

    // The App re-loads the rule after the save (loadV2EditTarget): what it
    // sees minus the now-cleared Znif key, keeping only the Boaz key. Feed
    // exactly that back as save #2's loadedLabels.
    const reloaded: Record<string, string> = {
      site: "il01",
      severity: "warning",
      "Appchi - Boaz": "true",
    };
    const second = buildPayload(
      { site: "il01", summary: "down", severity: "warning", "Appchi-$operator": "Appchi - Casim" },
      fields,
      "t",
      reloaded,
      {},
      {}
    );
    expect(second.clearLabels).toEqual(["Appchi - Boaz"]);
    expect(second.labels["Appchi - Casim"]).toBe("true");
    // Simulating the server-side merge of save #2 over the post-save-#1 rule
    // state: the merged label set must contain exactly ONE "Appchi - " key.
    const merged = { ...reloaded, ...second.labels };
    for (const key of second.clearLabels) delete merged[key];
    expect(Object.keys(merged).filter((k) => k.startsWith("Appchi - "))).toEqual([
      "Appchi - Casim",
    ]);
  });
});

