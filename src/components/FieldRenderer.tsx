import { useEffect, useState } from "react";
import type { FieldVerdict, StandardField, FieldState } from "../types";
import { NotificationPolicySelector } from "./NotificationPolicySelector";

interface FieldRendererProps {
  field: StandardField;
  verdict: FieldVerdict | undefined;
  policies: string[];
  value: string | null;
  /** Optional label override (e.g. "notification policy" for the operator field). */
  displayName?: string;
  onChange: (name: string, value: string) => void;
}

function computeFieldState(field: StandardField, verdict: FieldVerdict | undefined): FieldState {
  const optionalEmpty = { kind: "optional-empty" as const };

  if (!verdict) {
    if (field.required) return { kind: "empty-mandatory" };
    return field.default_value != null
      ? { kind: "default-applied", defaultValue: field.default_value }
      : optionalEmpty;
  }

  if (verdict.status === "COMPLIANT" && verdict.observed_value != null) {
    if (isValueValid(field, verdict.observed_value)) {
      return { kind: "carried-over", value: verdict.observed_value };
    }
    if (field.default_value != null) {
      return { kind: "default-applied", defaultValue: field.default_value };
    }
    return {
      kind: "needs-input",
      originalValue: verdict.observed_value,
      reason: verdict.message || "Value does not meet the standard",
    };
  }

  if (verdict.status === "COMPLIANT" && field.default_value != null) {
    return { kind: "default-applied", defaultValue: field.default_value };
  }

  if (verdict.status === "NON_COMPLIANT") {
    if (verdict.observed_value == null || verdict.observed_value === "") {
      if (field.required) return { kind: "empty-mandatory" };
      return field.default_value != null
        ? { kind: "default-applied", defaultValue: field.default_value }
        : optionalEmpty;
    }
    return {
      kind: "needs-input",
      originalValue: verdict.observed_value,
      reason: verdict.message || "Value does not meet the standard",
    };
  }

  if (field.required) return { kind: "empty-mandatory" };
  return field.default_value != null
    ? { kind: "default-applied", defaultValue: field.default_value }
    : optionalEmpty;
}

export function FieldRenderer({ field, verdict, policies, value, displayName, onChange }: FieldRendererProps) {
  const [localValue, setLocalValue] = useState(value || "");
  const state = computeFieldState(field, verdict);

  useEffect(() => {
    setLocalValue(value || "");
  }, [value]);

  const handleChange = (newValue: string) => {
    setLocalValue(newValue);
    onChange(field.name, newValue);
  };

  const isAppchiOperator = field.name === "Appchi-$operator";

  return (
    <div className={`field-row field-state-${state.kind}`}>
      <div className="field-header">
        <label htmlFor={`field-${field.name}`}>
          {displayName ?? field.name}
          {field.required && <span className="required">*</span>}
        </label>
        <span className="field-location">{field.location}</span>
      </div>
      <div className="field-meta">
        {field.explanation && <p className="explanation">{field.explanation}</p>}
        <p className="constraints">
          {field.constraints.min_length != null && `min ${field.constraints.min_length} chars `}
          {field.constraints.max_length != null && `max ${field.constraints.max_length} chars `}
          {field.constraints.allowed_values != null &&
            `allowed: ${field.constraints.allowed_values.join(", ")} `}
          {field.constraints.exact_value != null && `must be: ${field.constraints.exact_value} `}
          {field.default_value != null && `default: ${field.default_value}`}
        </p>
      </div>
      {isAppchiOperator ? (
        <NotificationPolicySelector
          policies={policies}
          selected={localValue || null}
          onSelect={(policy) => handleChange(policy)}
        />
      ) : field.constraints.allowed_values != null ? (
        <select
          id={`field-${field.name}`}
          value={localValue}
          onChange={(e) => handleChange(e.target.value)}
        >
          <option value="">Select...</option>
          {field.constraints.allowed_values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={`field-${field.name}`}
          type="text"
          value={localValue}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={field.default_value || undefined}
        />
      )}
      {state.kind === "carried-over" && <span className="badge carried">Carried over</span>}
      {state.kind === "needs-input" && (
        <div className="needs-input-reason">
          <span className="badge needs">Needs input</span>
          <span>{state.reason}</span>
        </div>
      )}
      {state.kind === "default-applied" && field.default_value != null && (
        <span className="badge default">Default applied: {field.default_value}</span>
      )}
      {state.kind === "empty-mandatory" && <span className="badge empty">Required</span>}
    </div>
  );
}

function isValueValid(field: StandardField, value: string): boolean {
  const c = field.constraints;
  if (c.exact_value != null && value !== c.exact_value) return false;
  if (c.starts_with != null && !value.startsWith(c.starts_with)) return false;
  if (c.allowed_values != null && !c.allowed_values.includes(value)) return false;
  if (c.min_length != null && value.length < c.min_length) return false;
  if (c.max_length != null && value.length > c.max_length) return false;
  return true;
}

