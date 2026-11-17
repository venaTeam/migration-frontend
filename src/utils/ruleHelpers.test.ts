import { describe, expect, it } from "vitest";
import type { FieldConstraints, StandardField, StandardSchema } from "../types";
import {
  buildRulePayload,
  getInitialValues,
  sortFieldsForDisplay,
  validateFormValues,
} from "./ruleHelpers";

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

const schema: StandardSchema = {
  version: "1.0",
  fields: [
    field({ name: "site", location: "label", required: true, constraints: { min_length: 3 } }),
    field({
      name: "severity",
      location: "label",
      constraints: { allowed_values: ["warning", "critical"] },
    }),
    field({ name: "summary", location: "annotation", required: true }),
    field({ name: "Appchi-$operator", location: "label" }),
    field({ name: "Send-Alert", location: "label", default_value: "true" }),
  ],
};

describe("validateFormValues", () => {
  it("flags required fields missing (after trim, empty string counts as missing)", () => {
    const errors = validateFormValues({ site: "   ", summary: "" }, schema);
    expect(errors).toContain("site is required");
    expect(errors).toContain("summary is required");
  });

  it("does not flag optional fields left empty", () => {
    const errors = validateFormValues({ site: "abc", summary: "s" }, schema);
    expect(errors).toEqual([]);
  });

  it("checks allowed_values", () => {
    const errors = validateFormValues(
      { site: "abc", summary: "s", severity: "bogus" },
      schema
    );
    expect(errors.join("; ")).toMatch(/severity must be one of/);
  });

  it("checks min_length on the trimmed value", () => {
    const errors = validateFormValues({ site: "ab", summary: "s" }, schema);
    expect(errors.join("; ")).toMatch(/site must be at least 3 characters/);
  });
});

describe("buildRulePayload", () => {
  it("maps label and annotation fields to their buckets", () => {
    const { labels, annotations } = buildRulePayload(
      { site: "il01", severity: "critical", summary: "down" },
      schema
    );
    expect(labels).toEqual({ site: "il01", severity: "critical", "Send-Alert": "true" });
    expect(annotations).toEqual({ summary: "down" });
  });

  it("turns the operator selection into a boolean label key", () => {
    const { labels } = buildRulePayload(
      { site: "il01", summary: "s", "Appchi-$operator": "Appchi - Znif" },
      schema
    );
    expect(labels["Appchi - Znif"]).toBe("true");
    expect(labels["Appchi-$operator"]).toBeUndefined();
  });

  it("always forces Send-Alert=true", () => {
    const { labels } = buildRulePayload({ site: "il01", summary: "s" }, schema);
    expect(labels["Send-Alert"]).toBe("true");
  });

  it("skips empty values (no empty-string labels or annotations)", () => {
    const { labels, annotations } = buildRulePayload(
      { site: "il01", summary: "s", severity: "" },
      schema
    );
    expect(labels).not.toHaveProperty("severity");
    expect(annotations).not.toHaveProperty("severity");
  });
});

describe("sortFieldsForDisplay", () => {
  it("puts site first, hides Send-Alert and the operator field", () => {
    const order = sortFieldsForDisplay(schema.fields).map((f) => f.name);
    expect(order[0]).toBe("site");
    expect(order).not.toContain("Send-Alert");
    expect(order).not.toContain("Appchi-$operator");
  });

  it("orders required before optional", () => {
    const order = sortFieldsForDisplay(schema.fields).map((f) => f.name);
    const summaryIdx = order.indexOf("summary");
    const severityIdx = order.indexOf("severity");
    expect(summaryIdx).toBeLessThan(severityIdx);
  });
});

describe("getInitialValues", () => {
  const evaluation = {
    fields: [
      { name: "site", observed_value: "il01", default_value: null },
      { name: "severity", observed_value: null, default_value: "warning" },
      { name: "Appchi-$operator", observed_value: "Appchi - Old", default_value: null },
    ],
  };

  it("uses a saved draft verbatim when present", () => {
    const values = getInitialValues(evaluation, "Appchi - New", { site: "draft" });
    expect(values).toEqual({ site: "draft" });
  });

  it("prefers observed value over default", () => {
    const values = getInitialValues(evaluation, undefined, undefined);
    expect(values.site).toBe("il01");
    expect(values.severity).toBe("warning");
  });

  it("operator override wins for the operator field", () => {
    const values = getInitialValues(evaluation, "Appchi - New", undefined);
    expect(values["Appchi-$operator"]).toBe("Appchi - New");
  });

  it("forces Send-Alert=true", () => {
    const values = getInitialValues(evaluation, undefined, undefined);
    expect(values["Send-Alert"]).toBe("true");
  });
});

