interface NotificationPolicySelectorProps {
  policies: string[];
  selected: string | null;
  onSelect: (policy: string) => void;
  disabled?: boolean;
}

export function NotificationPolicySelector({
  policies,
  selected,
  onSelect,
  disabled = false,
}: NotificationPolicySelectorProps) {
  const uniquePolicies = Array.from(new Set(policies));

  return (
    <select
      value={selected || ""}
      onChange={(e) => onSelect(e.target.value)}
      disabled={disabled || uniquePolicies.length === 0}
    >
      <option value="">
        {uniquePolicies.length === 0 ? "No Appchi policies found" : "Select notification policy"}
      </option>
      {uniquePolicies.map((policy) => (
        <option key={policy} value={policy}>
          {policy}
        </option>
      ))}
    </select>
  );
}

