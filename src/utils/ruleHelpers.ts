import type { StandardField, StandardSchema } from "../types";

export function validateFormValues(
  values: Record<string, string>,
  schema: StandardSchema
): string[] {
  const errors: string[] = [];
  for (const field of schema.fields) {
    const raw = values[field.name];
    const value = raw?.trim() ?? "";

    if (value === "") {
      if (field.required) {
        errors.push(`${field.name} is required`);
      }
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

export function buildRulePayload(
  values: Record<string, string>,
  schema: StandardSchema
): { labels: Record<string, string>; annotations: Record<string, string> } {
  const labels: Record<string, string> = {};
  const annotations: Record<string, string> = {};

  for (const field of schema.fields) {
    const value = values[field.name];
    if (value === undefined || value === "") {
      continue;
    }

    if (field.name === "Appchi-$operator") {
      if (value.trim() !== "") {
        labels[value] = "true";
      }
      continue;
    }

    if (field.location === "label") {
      labels[field.name] = value;
    } else {
      annotations[field.name] = value;
    }
  }

  labels["Send-Alert"] = "true";

  return { labels, annotations };
}

export function sortFieldsForDisplay(fields: StandardField[]): StandardField[] {
  const hidden = new Set(["Send-Alert", "Appchi-$operator"]);
  const visible = fields.filter((field) => !hidden.has(field.name));

  return visible.sort((a, b) => {
    if (a.name === "site") return -1;
    if (b.name === "site") return 1;

    if (a.required && !b.required) return -1;
    if (!a.required && b.required) return 1;

    const aHasDefault = a.default_value != null;
    const bHasDefault = b.default_value != null;
    if (aHasDefault && !bHasDefault) return -1;
    if (!aHasDefault && bHasDefault) return 1;

    return 0;
  });
}

export function getInitialValues(
  evaluation: { fields: { name: string; observed_value: string | null; default_value: string | null }[] },
  operator: string | undefined,
  savedDraft: Record<string, string> | undefined
): Record<string, string> {
  if (savedDraft) {
    return { ...savedDraft };
  }

  const initialValues: Record<string, string> = {};
  for (const verdict of evaluation.fields) {
    if (verdict.name === "Appchi-$operator" && operator != null) {
      initialValues[verdict.name] = operator;
    } else if (verdict.observed_value != null) {
      initialValues[verdict.name] = verdict.observed_value;
    } else if (verdict.default_value != null) {
      initialValues[verdict.name] = verdict.default_value;
    }
  }
  initialValues["Send-Alert"] = "true";
  return initialValues;
}

