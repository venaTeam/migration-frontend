import { useEffect, useState } from "react";
import { NotificationPolicySelector } from "./NotificationPolicySelector";
import { fetchNotificationPolicies } from "../api/client";

interface CreateRuleInputProps {
  onSubmit: (folderUrl: string, title: string, operator: string) => void;
  onCancel: () => void;
  loading: boolean;
}

export function CreateRuleInput({ onSubmit, onCancel, loading }: CreateRuleInputProps) {
  const [folderUrl, setFolderUrl] = useState("");
  const [title, setTitle] = useState("");
  const [policies, setPolicies] = useState<string[]>([]);
  const [selectedPolicy, setSelectedPolicy] = useState<string>("");
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policyError, setPolicyError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchNotificationPolicies();
        setPolicies(data);
      } catch (err) {
        setPolicyError(err instanceof Error ? err.message : "Failed to load notification policies");
      } finally {
        setPolicyLoading(false);
      }
    }
    load();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedFolder = folderUrl.trim();
    const trimmedTitle = title.trim();
    const trimmedPolicy = selectedPolicy.trim();
    if (!trimmedFolder || !trimmedTitle || !trimmedPolicy) return;
    onSubmit(trimmedFolder, trimmedTitle, trimmedPolicy);
  };

  return (
    <form onSubmit={handleSubmit} className="card">
      <h2>Create new v2 alert rule</h2>
      <p className="help-text">
        Provide the Grafana folder URL where the new rule should live, the rule title, and the notification policy.
      </p>
      <div className="field">
        <label htmlFor="create-folder-url">Folder URL</label>
        <input
          id="create-folder-url"
          type="text"
          value={folderUrl}
          onChange={(e) => setFolderUrl(e.target.value)}
          placeholder="https://grafana/dashboards/f/<uid>"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="create-rule-title">Rule title</label>
        <input
          id="create-rule-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="My new v2 alert rule"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="create-notification-policy">Notification policy</label>
        {policyError && <div className="error">{policyError}</div>}
        <NotificationPolicySelector
          policies={policies}
          selected={selectedPolicy || null}
          onSelect={setSelectedPolicy}
          disabled={policyLoading || loading}
        />
      </div>
      <div className="clone-buttons">
        <button type="submit" disabled={loading || policyLoading || !selectedPolicy}>
          {loading ? "Loading..." : "Continue"}
        </button>
        <button type="button" onClick={onCancel} className="secondary" disabled={loading}>
          Cancel
        </button>
      </div>
    </form>
  );
}

