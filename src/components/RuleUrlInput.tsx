import { useState } from "react";

interface RuleUrlInputProps {
  onLoad: (ruleUrl: string) => void;
  onLoadFolder?: (folderUrl: string) => void;
  loading: boolean;
}

function looksLikeFolderUrl(url: string): boolean {
  return /\/dashboards\/f\//.test(url) || /\/folders\//.test(url);
}

export function RuleUrlInput({ onLoad, onLoadFolder, loading }: RuleUrlInputProps) {
  const [ruleUrl, setRuleUrl] = useState("");

  const isFolder = looksLikeFolderUrl(ruleUrl.trim());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = ruleUrl.trim();
    if (!trimmed || loading) return;
    if (isFolder) {
      onLoadFolder?.(trimmed);
    } else {
      onLoad(trimmed);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card">
      <h2>Load Alert Rule</h2>
      <div className="field">
        <label htmlFor="rule-url">Grafana alert rule URL / UID or folder URL</label>
        <input
          id="rule-url"
          type="text"
          value={ruleUrl}
          onChange={(e) => setRuleUrl(e.target.value)}
          placeholder="https://grafana/alerting/grafana/<uid>/edit or https://grafana/dashboards/f/<uid>"
          required
        />
      </div>
      <button type="submit" disabled={loading}>
        {loading ? "Loading..." : "Load rule / folder"}
      </button>
    </form>
  );
}

