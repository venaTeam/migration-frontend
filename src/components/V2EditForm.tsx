import { useEffect, useState } from "react";
import type { StandardSchema } from "../types";
import { fetchNotificationPolicies, fetchStandardSchema } from "../api/client";
import { FieldRenderer } from "./FieldRenderer";

interface V2EditFormProps {
  uid: string;
  title: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  /** Non-schema labels the rule carries; edits don't touch them, save preserves them. */
  extraLabels: Record<string, string>;
  /** Non-schema annotations preserved on save (unless the user clears one). */
  extraAnnotations: Record<string, string>;
  saveError: string | null;
  saving: boolean;
  onSave: (payload: {
    title: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    clearAnnotations?: string[];
    clearLabels?: string[];
  }) => void;
  onBack: () => void;
}

/**
 * Edit form for an existing v2 rule. Field values come straight from the
 * rule's current labels/annotations (no per-field compliance verdicts).
 * On save, App PUTs the rule in place via /api/rules/view/:uid, which
 * re-validates against the standard schema server-side.
 */
export function V2EditForm({
  uid,
  title,
  labels,
  annotations,
  extraLabels,
  extraAnnotations,
  saveError,
  saving,
  onSave,
  onBack,
}: V2EditFormProps) {
  const [schema, setSchema] = useState<StandardSchema | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [policies, setPolicies] = useState<string[]>([]);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const schemaData = await fetchStandardSchema();
        setSchema(schemaData);

        const initialValues: Record<string, string> = {};
        for (const field of schemaData.fields) {
          if (field.location === "label") {
            if (field.name === "Appchi-$operator") {
              const key = Object.keys(labels).find((k) => k.startsWith("Appchi - "));
              initialValues[field.name] = key ?? "";
            } else if (field.name === "component") {
              initialValues[field.name] = labels["component"] ?? labels["object"] ?? "";
            } else {
              initialValues[field.name] = labels[field.name] ?? "";
            }
          } else {
            initialValues[field.name] = annotations[field.name] ?? "";
          }
        }
        setValues(initialValues);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load schema");
      }
    }
    void load();
    // Rule content is fixed per opened rule; don't re-derive on every keystroke.
  }, [uid]);

  useEffect(() => {
    async function loadPolicies() {
      try {
        const data = await fetchNotificationPolicies();
        setPolicies(data);
      } catch (err) {
        // Surface the failure — "backend error" must not merge with
        // "genuinely no policies": the dropdown is disabled either way, but
        // the user needs to know why (and can Retry below).
        setPolicyError(
          err instanceof Error ? err.message : "Failed to load notification policies"
        );
      }
    }
    loadPolicies();
  }, []);

  const handleChange = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = () => {
    if (!schema) return;
    const errors = validate(values, schema.fields);
    if (errors.length > 0) {
      setValidationError(errors.join("; "));
      return;
    }
    setValidationError(null);
    onSave(buildPayload(values, schema.fields, title, labels, extraLabels, extraAnnotations));
  };

  if (loadError) return <div className="card error">{loadError}</div>;
  if (!schema) return <div className="card">Loading standard schema...</div>;

  const sortedFields = [...schema.fields].sort((a, b) => {
    if (a.name === "site") return -1;
    if (b.name === "site") return 1;
    if (a.required !== b.required) return a.required ? -1 : 1;
    return 0;
  });

  return (
    <div className="v2-edit">
      <div className="form-header">
        <h2>Edit v2 rule</h2>
        <span className="subtitle">{title}</span>
      </div>
      <div className="form-back">
        <button type="button" onClick={onBack} className="secondary">
          ↩ Back to folder
        </button>
      </div>
      {policyError && (
        <div className="card error">
          {policyError}
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setPolicyError(null);
              (async function retryPolicies() {
                try {
                  setPolicies(await fetchNotificationPolicies());
                } catch (err) {
                  setPolicyError(
                    err instanceof Error ? err.message : "Failed to load notification policies"
                  );
                }
              })();
            }}
          >
            Retry
          </button>
        </div>
      )}
      <form className="standard-form" onSubmit={(e) => e.preventDefault()}>
        {sortedFields
          .filter((f) => f.name !== "Send-Alert")
          .map((field) => (
            <FieldRenderer
              key={`${uid}-${field.name}`}
              field={field}
              displayName={
                field.name === "Appchi-$operator" ? "notification policy" : undefined
              }
              verdict={makeVerdict(field, values[field.name])}
              policies={policies}
              value={values[field.name] || null}
              onChange={handleChange}
            />
          ))}
      </form>
      <div className="card clone-actions">
        {validationError && <div className="error">{validationError}</div>}
        {saveError && <div className="error">{saveError}</div>}
        <div className="clone-buttons">
          <button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
        <p className="help-text">
          Saving updates this rule in Grafana in place. The rule must stay compliant with the
          standard after the edit.
        </p>
      </div>
    </div>
  );
}

export function validate(
  values: Record<string, string>,
  fields: StandardSchema["fields"]
): string[] {
  const errors: string[] = [];
  for (const field of fields) {
    if (field.name === "Send-Alert") continue;
    const value = (values[field.name] ?? "").trim();
    if (value === "") {
      if (field.required) errors.push(`${field.name} is required`);
      continue;
    }
    const c = field.constraints;
    if (c.exact_value != null && value !== c.exact_value) {
      errors.push(`${field.name} must be exactly "${c.exact_value}"`);
    }
    if (c.starts_with != null && !value.startsWith(c.starts_with)) {
      errors.push(`${field.name} must start with "${c.starts_with}"`);
    }
    if (c.allowed_values != null && !c.allowed_values.includes(value)) {
      errors.push(`${field.name} must be one of: ${c.allowed_values.join(", ")}`);
    }
    if (c.min_length != null && value.length < c.min_length) {
      errors.push(`${field.name} must be at least ${c.min_length} characters`);
    }
    if (c.max_length != null && value.length > c.max_length) {
      errors.push(`${field.name} must be at most ${c.max_length} characters`);
    }
  }
  return errors;
}

export function buildPayload(
  values: Record<string, string>,
  fields: StandardSchema["fields"],
  currentTitle: string,
  loadedLabels: Record<string, string>,
  extraLabels: Record<string, string>,
  extraAnnotations: Record<string, string>
): {
  title: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  clearAnnotations: string[];
  clearLabels: string[];
} {
  const labels: Record<string, string> = { ...extraLabels };
  const annotations: Record<string, string> = { ...extraAnnotations };
  // The rule's label set as loaded — the only place the CURRENT operator key
  // ("Appchi - <name>") still exists, since extras deliberately exclude it.
  const loadedOperatorKey =
    Object.keys(loadedLabels).find((k) => k.startsWith("Appchi - ")) || null;

  for (const field of fields) {
    const value = (values[field.name] ?? "").trim();
    if (value === "") continue;

    if (field.name === "Appchi-$operator") {
      labels[value] = "true";
      continue;
    }
    if (field.location === "label") labels[field.name] = value;
    else annotations[field.name] = value;
  }

  labels["Send-Alert"] = "true";

  // Schema annotation fields the user emptied are removed from the rule instead
  // of being preserved by the server-side merge. The previous "Appchi - <name>"
  // label key is removed when the operator was changed — a merge alone can't
  // delete the old key.
  const clearAnnotations = fields
    .filter((f) => f.location === "annotation" && f.name !== "Send-Alert")
    .map((f) => f.name)
    .filter((name) => (values[name] ?? "").trim() === "");
  // An emptied schema annotation must not ride along via extraAnnotations
  // either — drop it from the payload so the server-side merge removes it.
  for (const name of clearAnnotations) delete annotations[name];
  // Same for emptied schema labels: never re-merge their old value.
  for (const f of fields) {
    if (f.location !== "label" || f.name === "Send-Alert") continue;
    if ((values[f.name] ?? "").trim() === "") {
      delete labels[f.name];
    }
  }
  // Emptied optional schema labels are removed from the rule too (the merge
  // alone can't delete keys) — same semantics as the annotation path.
  const clearedSchemaLabels = fields
    .filter((f) => f.location === "label" && f.name !== "Send-Alert")
    .map((f) => f.name)
    .filter((name) => (values[name] ?? "").trim() === "");
  const currentOperatorValue = values["Appchi-$operator"]?.trim() || null;
  // Clear the loaded operator key when the operator was changed — a merge
  // alone can't remove it, and the compliance engine resolves the operator
  // from the FIRST "Appchi - " label key.
  const operatorChanged =
    Boolean(loadedOperatorKey) && loadedOperatorKey !== currentOperatorValue;
  const clearLabels = [
    ...clearedSchemaLabels,
    ...(operatorChanged && loadedOperatorKey ? [loadedOperatorKey] : []),
  ];

  return { title: currentTitle, labels, annotations, clearAnnotations, clearLabels };
}

function makeVerdict(
  field: StandardSchema["fields"][number],
  value: string
) {
  return {
    name: field.name,
    location: field.location,
    status: "COMPLIANT" as const,
    observed_value: value || null,
    expected_value: null,
    default_value: field.default_value,
    reason_code: "V2_EDIT",
    message: "",
  };
}

