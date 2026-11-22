import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { EvaluateResponse, StandardSchema } from "../types";
import { fetchNotificationPolicies, fetchStandardSchema } from "../api/client";
import { FieldRenderer } from "./FieldRenderer";
import {
  buildRulePayload,
  getInitialValues,
  sortFieldsForDisplay,
  validateFormValues,
} from "../utils/ruleHelpers";

export interface StandardFormRef {
  getValues: () => Record<string, string>;
}

interface StandardFormProps {
  evaluation: EvaluateResponse;
  initialValues?: Record<string, string>;
  onCreateClone: (labels: Record<string, string>, annotations: Record<string, string>, folderUrl?: string) => void;
  onCreateCloneAndDelete?: (labels: Record<string, string>, annotations: Record<string, string>, folderUrl?: string) => void;
  onReturn?: () => void;
  cloneLoading: boolean;
  cloneError: string | null;
  operator?: string;
  isFolderMode?: boolean;
  ruleCreated?: boolean;
  isCreateMode?: boolean;
  destFolderUrl?: string;
  onDestFolderUrlChange?: (url: string) => void;
  /** Single-rule mode: open the rule's whole folder. */
  onViewFolder?: () => void;
  viewFolderLoading?: boolean;
}

export const StandardForm = forwardRef<StandardFormRef, StandardFormProps>(
  function StandardForm(
    {
      evaluation,
      initialValues,
      onCreateClone,
      onCreateCloneAndDelete,
      onReturn,
      cloneLoading,
      cloneError,
      operator,
      isFolderMode = false,
      ruleCreated = false,
      isCreateMode = false,
      destFolderUrl: destFolderUrlProp,
      onDestFolderUrlChange,
      onViewFolder,
      viewFolderLoading = false,
    },
    ref
  ) {
    const [schema, setSchema] = useState<StandardSchema | null>(null);
    const [policies, setPolicies] = useState<string[]>([]);
    const [policyError, setPolicyError] = useState<string | null>(null);
    const [values, setValues] = useState<Record<string, string>>({});
    const [error, setError] = useState<string | null>(null);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    // Controlled by App when onDestFolderUrlChange is given (bulk folder mode);
    // self-managed state otherwise (single-rule clone).
    const [locallyManaged, setLocallyManaged] = useState("");
    const destFolderUrl = onDestFolderUrlChange != null ? (destFolderUrlProp ?? "") : locallyManaged;
    const setDestFolderUrl = (url: string) => {
      if (onDestFolderUrlChange != null) {
        onDestFolderUrlChange(url);
      } else {
        setLocallyManaged(url);
      }
    };

    useImperativeHandle(ref, () => ({
      getValues: () => values,
    }));

    useEffect(() => {
      async function load() {
        try {
          const schemaData = await fetchStandardSchema();
          setSchema(schemaData);
          const initial = getInitialValues(evaluation, operator, initialValues);
          setValues(initial);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to load form data");
        } finally {
          setLoading(false);
        }
      }
      load();
    }, [evaluation, operator, initialValues]);

    // The Appchi-$operator field is a notification-policy dropdown. Without
    // this fetch it renders with zero options and is permanently disabled
    // (FieldRenderer → NotificationPolicySelector), which blocks creating a
    // v2 rule whenever the form opens without a session operator — e.g.
    // "Open anyway" on a migrated rule. Same load/retry pattern as V2EditForm.
    useEffect(() => {
      let cancelled = false;
      async function loadPolicies() {
        try {
          const data = await fetchNotificationPolicies();
          if (!cancelled) {
            setPolicies(data);
            setPolicyError(null);
          }
        } catch (err) {
          if (!cancelled) {
            // Distinguish "Grafana has no Appchi policies" from a failed
            // request: the dropdown is disabled either way, but the retry
            // affordance only makes sense for the latter.
            setPolicyError(
              err instanceof Error ? err.message : "Failed to load notification policies"
            );
          }
        }
      }
      loadPolicies();
      return () => {
        cancelled = true;
      };
    }, []);

    const handleChange = (name: string, value: string) => {
      setValues((prev) => ({ ...prev, [name]: value }));
    };

    const handleCreateClone = () => {
      if (!schema) return;
      const errors = validateFormValues(values, schema);
      if (errors.length > 0) {
        setValidationError(errors.join("; "));
        return;
      }
      setValidationError(null);
      const { labels, annotations } = buildRulePayload(values, schema);
      onCreateClone(labels, annotations, destFolderUrl || undefined);
    };

    const handleCreateCloneAndDelete = () => {
      if (!schema || !onCreateCloneAndDelete) return;
      const errors = validateFormValues(values, schema);
      if (errors.length > 0) {
        setValidationError(errors.join("; "));
        return;
      }
      setValidationError(null);
      const { labels, annotations } = buildRulePayload(values, schema);
      onCreateCloneAndDelete(labels, annotations, destFolderUrl || undefined);
    };

    if (loading) return <div className="card">Loading standard form...</div>;
    if (error) return <div className="card error">{error}</div>;
    if (!schema) return <div className="card error">Schema not available</div>;

    const verdictMap = new Map(evaluation.fields.map((f) => [f.name, f]));
    const sortedFields = sortFieldsForDisplay(schema.fields);

    return (
      <div>
        {/* Folder mode already shows the title in the folder-nav card — only
            single-rule and create modes need a header here. */}
        {!isCreateMode && !isFolderMode && (
          <div className="form-header">
            <h2>{evaluation.rule_title || evaluation.rule_uid}</h2>
            {onViewFolder && (
              <button type="button" className="secondary" onClick={onViewFolder} disabled={viewFolderLoading}>
                {viewFolderLoading ? "Loading folder…" : "View entire folder"}
              </button>
            )}
          </div>
        )}
        {onReturn && (
          <div className="form-back">
            <button type="button" onClick={onReturn} className="secondary">
              ↩︎ Back to folder
            </button>
          </div>
        )}
        {isCreateMode && (
          <div className="form-header">
            <h2>Create new v2 alert rule</h2>
          </div>
        )}
        {!isCreateMode && (
          <div className="card dest-folder">
            <label htmlFor="dest-folder-url" className="dest-folder-label">
              Destination folder URL (optional)
            </label>
            <input
              id="dest-folder-url"
              type="text"
              value={destFolderUrl}
              onChange={(e) => setDestFolderUrl(e.target.value)}
              placeholder="Leave empty to create the v2 rule in the same folder"
            />
            <p className="help-text">
              Paste a Grafana folder URL to create the v2 rule there. If left empty, the v2 rule is
              created in the same folder as the original rule.
            </p>
          </div>
        )}
        <form className="standard-form">
          {sortedFields.map((field) => (
            <FieldRenderer
              key={`${evaluation.rule_uid}-${field.name}`}
              field={field}
              verdict={verdictMap.get(field.name)}
              policies={policies}
              value={values[field.name] || null}
              onChange={handleChange}
            />
          ))}
        </form>
        {policyError && (
          <div className="card error">
            {policyError}{" "}
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
        <div className="card clone-actions">
          {validationError && <div className="error">{validationError}</div>}
          {cloneError && <div className="error">{cloneError}</div>}
          <div className="clone-buttons">
            <button type="button" onClick={handleCreateClone} disabled={cloneLoading || ruleCreated}>
              {ruleCreated
                ? "Rule created"
                : cloneLoading
                ? "Creating v2 rule..."
                : isCreateMode
                ? "Create rule"
                : "Create v2 rule"}
            </button>
            {onCreateCloneAndDelete && !isCreateMode && (
              <button
                type="button"
                onClick={handleCreateCloneAndDelete}
                disabled={cloneLoading || ruleCreated}
                className="danger"
              >
                {ruleCreated
                  ? "Original rule deleted"
                  : cloneLoading
                  ? "Creating and deleting..."
                  : "Create v2 rule & delete original"}
              </button>
            )}
          </div>
          <p className="help-text">
            {isCreateMode
              ? "Creates a new v2 alert rule in the folder with the standard fields you fill below."
              : isFolderMode
              ? "Creates a v2 copy of the current rule only. The second button also deletes the original rule."
              : "Creates a v2 copy of the rule. The original rule is left unchanged."}
          </p>
          {onCreateCloneAndDelete && !isCreateMode && (
            <p className="help-text danger-text">
              The second button creates the v2 copy and then deletes the original rule.
            </p>
          )}
        </div>
      </div>
    );
  }
);

