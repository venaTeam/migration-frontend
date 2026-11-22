export interface FieldConstraints {
  min_length?: number | null;
  max_length?: number | null;
  allowed_values?: string[] | null;
  exact_value?: string | null;
  starts_with?: string | null;
}

export interface StandardField {
  name: string;
  location: "label" | "annotation";
  required: boolean;
  explanation: string;
  constraints: FieldConstraints;
  default_value: string | null;
}

export interface StandardSchema {
  version: string;
  fields: StandardField[];
}

export interface LabelSetResult {
  labels: Record<string, string>;
  breach_count: number;
  firing_periods: [string, string][];
}

export interface BacktestResponse {
  rule_query: string;
  threshold: number;
  condition: string;
  window_hours: number;
  total_breaches: number;
  per_label_set: LabelSetResult[];
  message: string;
}

export interface FieldVerdict {
  name: string;
  location: "label" | "annotation";
  status: "COMPLIANT" | "NON_COMPLIANT";
  observed_value: string | null;
  expected_value: string | null;
  default_value: string | null;
  reason_code: string;
  message: string;
}

export interface EvaluateResponse {
  rule_uid: string;
  rule_title: string;
  standard_version: string;
  overall_status: "COMPLIANT" | "NON_COMPLIANT";
  fields: FieldVerdict[];
  /** True when the registry says this rule was already migrated (single-rule load warning, plan §7.3). */
  migrated?: boolean;
  /** Grafana folder the rule lives in; drives "View entire folder". */
  folder_uid?: string | null;
}

export type FieldState =
  | { kind: "carried-over"; value: string }
  | { kind: "needs-input"; originalValue: string | null; reason: string }
  | { kind: "default-applied"; defaultValue: string }
  | { kind: "empty-mandatory" }
  | { kind: "optional-empty" };

