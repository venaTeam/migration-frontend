import { useEffect, useState } from "react";
import { fetchNotificationPolicies } from "../api/client";
import { NotificationPolicySelector } from "./NotificationPolicySelector";

interface OperatorSelectorProps {
  defaultOperator?: string;
  onConfirm: (operator: string) => void;
}

export function OperatorSelector({ defaultOperator, onConfirm }: OperatorSelectorProps) {
  const [policies, setPolicies] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>(defaultOperator || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchNotificationPolicies();
        setPolicies(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load notification policies");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className="card">Loading notification policies...</div>;
  if (error) return <div className="card error">{error}</div>;

  return (
    <div className="card">
      <h2>Select notification policy</h2>
      <p className="help-text">
        Choose the team's Appchi notification policy. This will be applied to all rules you migrate
        in this session.
      </p>
      <NotificationPolicySelector policies={policies} selected={selected || null} onSelect={setSelected} />
      <div className="clone-actions">
        <button onClick={() => onConfirm(selected)} disabled={!selected}>
          Continue
        </button>
      </div>
    </div>
  );
}

