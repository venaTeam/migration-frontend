import { useState } from "react";
import { runBacktest } from "../api/client";

import type { BacktestResponse } from "../types";

interface BacktestPreviewProps {
  ruleUid: string;
}

export function BacktestPreview({ ruleUid }: BacktestPreviewProps) {
  const [query, setQuery] = useState("");
  const [threshold, setThreshold] = useState("0");
  const [condition, setCondition] = useState<"gt" | "gte" | "lt" | "lte" | "eq" | "neq">("gt");
  const [windowHours, setWindowHours] = useState(24);
  const [forSeconds, setForSeconds] = useState(0);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await runBacktest({
        rule_query: query,
        threshold: Number(threshold),
        condition,
        for_duration_seconds: forSeconds,
        window_hours: windowHours,
      });
      setResult(response);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Backtest failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>Backtest: {ruleUid}</h2>
      <p>
        Preview how many times this rule would have fired over a recent window. Enter the rule
        query and threshold from Grafana.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="query">PromQL query</label>
          <input
            id="query"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='up{job="api"} == 0'
            required
          />
        </div>
        <div className="field-row-inline">
          <div className="field">
            <label htmlFor="condition">Condition</label>
            <select
              id="condition"
              value={condition}
              onChange={(e) => setCondition(e.target.value as typeof condition)}
            >
              <option value="gt">greater than</option>
              <option value="gte">greater or equal</option>
              <option value="lt">less than</option>
              <option value="lte">less or equal</option>
              <option value="eq">equals</option>
              <option value="neq">not equals</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="threshold">Threshold</label>
            <input
              id="threshold"
              type="number"
              step="any"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="window">Window (hours)</label>
            <input
              id="window"
              type="number"
              min={1}
              max={168}
              value={windowHours}
              onChange={(e) => setWindowHours(Number(e.target.value))}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="for">For (seconds)</label>
            <input
              id="for"
              type="number"
              min={0}
              value={forSeconds}
              onChange={(e) => setForSeconds(Number(e.target.value))}
            />
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={loading}>
          {loading ? "Running..." : "Run backtest"}
        </button>
      </form>

      {result && (
        <div className="backtest-result">
          <h3>{result.message}</h3>
          {result.per_label_set.length > 0 && (
            <table className="backtest-table">
              <thead>
                <tr>
                  <th>Label set</th>
                  <th>Breach count</th>
                </tr>
              </thead>
              <tbody>
                {result.per_label_set.map((item, idx) => (
                  <tr key={idx}>
                    <td>
                      {Object.entries(item.labels)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(", ") || "(none)"}
                    </td>
                    <td>{item.breach_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

