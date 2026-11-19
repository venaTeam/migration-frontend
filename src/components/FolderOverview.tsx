import { useState } from "react";
import type { FolderRuleSummary } from "../api/client";

interface FolderOverviewProps {
  v1: FolderRuleSummary[];
  v2: FolderRuleSummary[];
  loading: boolean;
  error: string | null;
  /** UIDs whose migration clones were created in this session ("created" chip). */
  createdUids: Set<string>;
  /** Per-row Save status for v2 rules edited in this session. */
  editStatus?: Record<string, string>;
  /** True while a wizard entry load is in flight — Edit buttons disable. */
  editDisabled?: boolean;
  onEditRule: (summary: FolderRuleSummary) => void;
  onDeleteRule: (uid: string) => void;
  onBack: () => void;
}

interface RowActionsProps {
  rule: FolderRuleSummary;
  created: boolean;
  status?: string;
  onEdit: (summary: FolderRuleSummary) => void;
  onDelete: (uid: string) => void;
}

function RuleRow({
  rule,
  created,
  status,
  editDisabled,
  onEdit,
  onDelete,
}: RowActionsProps & { editDisabled?: boolean }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <li className="rule-row rule-row-confirming">
        <div className="rule-row-main">
          <span className="rule-title">{rule.title}</span>
          <span className="rule-confirm-text">Delete this rule from Grafana? This cannot be undone.</span>
        </div>
        <div className="rule-row-actions">
          <button type="button" className="danger" onClick={() => onDelete(rule.uid)}>
            Confirm delete
          </button>
          <button type="button" className="secondary" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="rule-row">
      <div className="rule-row-main">
        <span className="rule-title">
          {rule.title} {created && <span className="chip-created">created</span>}{" "}
          {rule.migrated && <span className="chip-migrated">Migrated</span>}
        </span>
        <a href={rule.rule_url} target="_blank" rel="noopener noreferrer">
          Open in Grafana
        </a>
        {status && <span className="rule-status">{status}</span>}
      </div>
      <div className="rule-row-actions">
        <button
          type="button"
          className="secondary"
          disabled={editDisabled}
          onClick={() => onEdit(rule)}
        >
          Edit
        </button>
        <button type="button" className="danger" onClick={() => setConfirming(true)}>
          Delete
        </button>
      </div>
    </li>
  );
}

function Side({
  title,
  rules,
  createdUids,
  emptyText,
  allMigratedText,
  editStatus,
  editDisabled,
  onEditRule,
  onDeleteRule,
}: {
  title: string;
  rules: FolderRuleSummary[];
  createdUids: Set<string>;
  emptyText: string;
  /** Shown above the badge rows when every rule is migrated (nothing hidden). */
  allMigratedText?: string;
  editStatus?: Record<string, string>;
  editDisabled?: boolean;
  onEditRule: (summary: FolderRuleSummary) => void;
  onDeleteRule: (uid: string) => void;
}) {
  const allMigrated = allMigratedText != null && rules.length > 0 && rules.every((r) => r.migrated);
  return (
    <div className="card overview-side">
      <h2>{title}</h2>
      {rules.length === 0 ? (
        <p className="help-text">{emptyText}</p>
      ) : (
        <>
          {allMigrated && <p className="help-text">{allMigratedText}</p>}
          <ul className="rule-list">
            {rules.map((rule) => (
              <RuleRow
                key={rule.uid}
                rule={rule}
                created={createdUids.has(rule.uid)}
                status={editStatus?.[rule.uid]}
                editDisabled={editDisabled}
                onEdit={onEditRule}
                onDelete={onDeleteRule}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function FolderOverview({
  v1,
  v2,
  loading,
  error,
  createdUids,
  editStatus,
  editDisabled,
  onEditRule,
  onDeleteRule,
  onBack,
}: FolderOverviewProps) {
  return (
    <div className="folder-overview">
      <div className="folder-review-header">
        <button type="button" className="secondary" onClick={onBack}>
          ↩︎ Load a different rule / folder
        </button>
      </div>
      {error && <div className="card error">{error}</div>}
      {loading && !error ? (
        <div className="card">Loading folder...</div>
      ) : (
        <div className="overview-columns">
          <Side
            title={`Appchi v1 rules in this folder (${v1.length})`}
            rules={v1}
            createdUids={new Set()}
            emptyText="No v1 rules in this folder."
            allMigratedText="All v1 rules in this folder have already been migrated."
            editDisabled={editDisabled}
            onEditRule={onEditRule}
            onDeleteRule={onDeleteRule}
          />
          <Side
            title={`Appchi v2 rules in this folder (${v2.length})`}
            rules={v2}
            createdUids={createdUids}
            emptyText="No v2 rules in this folder."
            editStatus={editStatus}
            editDisabled={editDisabled}
            onEditRule={onEditRule}
            onDeleteRule={onDeleteRule}
          />
        </div>
      )}
    </div>
  );
}

