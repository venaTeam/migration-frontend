import { useEffect, useRef, useState } from "react";
import { CreateRuleInput } from "./components/CreateRuleInput";
import { FolderOverview } from "./components/FolderOverview";
import { LoginForm } from "./components/LoginForm";
import { OperatorSelector } from "./components/OperatorSelector";
import { RuleUrlInput } from "./components/RuleUrlInput";
import { StandardForm, type StandardFormRef } from "./components/StandardForm";
import { V2EditForm } from "./components/V2EditForm";
import {
  cloneAndDeleteRule,
  cloneRule,
  createRule,
  deleteRuleView,
  fetchStandardSchema,
  loadFolderClassified,
  loadRule,
  loadRuleList,
  logout,
  setUnauthorizedHandler,
  updateRuleView,
} from "./api/client";
import { buildRulePayload, validateFormValues } from "./utils/ruleHelpers";
import {
  folderUrlFor,
  hrefWithTarget,
  isHttpUrl,
  parseDeepLink,
  type DeepLinkTarget,
} from "./utils/deepLink";
import type { EvaluateResponse, StandardSchema } from "./types";
import type { ClassifiedFolderRules, FolderRuleSummary, RuleListSkip } from "./api/client";

type View =
  | "checking"
  | "login"
  | "load"
  | "folder-overview"
  | "operator"
  | "form"
  | "migrated-notice"
  | "create-input"
  | "create-form"
  | "v2-edit";

interface V2EditTarget {
  uid: string;
  title: string;
  rule_url: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  /** Non-schema labels the rule carries; user edits don't touch them. */
  extraLabels: Record<string, string>;
  /** Non-schema annotations preserved on save (unless user clears a schema one). */
  extraAnnotations: Record<string, string>;
}

interface RuleDraft {
  values: Record<string, string>;
}

interface CloneResult {
  action: "created" | "updated";
  rule_uid: string;
  rule_url: string;
  title: string;
  original_deleted?: boolean;
}

function App() {
  // Optimistic start on the load view: if the backend session is still
  // alive (page refresh), the user is simply in the app. If it is dead,
  // the first API call answers 401 and the central handler in apiFetch
  // drops to the login view — no mount-time probe needed.
  const [view, setView] = useState<View>("load");
  // The ?rule_url= / ?folder_url= the page was opened with (e.g. from alerts-bi).
  const [initialLink] = useState(() => parseDeepLink(window.location.search));
  // What the address bar points at: the rule/folder being viewed, kept across a
  // 401 so it reopens after login. Cleared on the way back to the paste box.
  const [linkTarget, setLinkTargetState] = useState<DeepLinkTarget | null>(
    initialLink.status === "ok" ? initialLink.target : null
  );
  const linkOpened = useRef(false);
  // A rule or folder has been shown at least once (login text says "reopen").
  const targetShown = useRef(false);
  // Set by the 401 handler: a failed load must not replace the login view.
  const sessionLost = useRef(false);
  const [evaluation, setEvaluation] = useState<EvaluateResponse | null>(null);
  const [error, setError] = useState<string | null>(
    initialLink.status === "invalid" ? initialLink.message : null
  );
  const [loading, setLoading] = useState(false);
  const [cloneLoading, setCloneLoading] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [cloneResults, setCloneResults] = useState<CloneResult[]>([]);

  const [folderRules, setFolderRules] = useState<FolderRuleSummary[] | null>(null);
  const [folderIndex, setFolderIndex] = useState<number>(0);
  // Rules a several-rule link couldn't include (migrated, no access, ...).
  const [listSkipped, setListSkipped] = useState<RuleListSkip[]>([]);
  // The migrated rule currently shown on the notice card (migrated-notice view).
  const [noticeRule, setNoticeRule] = useState<FolderRuleSummary | null>(null);
  const [operator, setOperator] = useState<string | undefined>(undefined);
  const [drafts, setDrafts] = useState<Record<string, RuleDraft>>({});
  const [schema, setSchema] = useState<StandardSchema | null>(null);
  const [createdRuleUids, setCreatedRuleUids] = useState<Set<string>>(new Set());
  const [createFolderUrl, setCreateFolderUrl] = useState<string>("");
  const [createRuleTitle, setCreateRuleTitle] = useState<string>("");
  const [syntheticEvaluation, setSyntheticEvaluation] = useState<EvaluateResponse | null>(null);
  // Create-flow success latch: after the backend /create returns, the form's
  // button disables (ruleCreated) so a second click can't create a duplicate
  // skeleton rule — the backend creates unconditionally.
  const [createRuleCreated, setCreateRuleCreated] = useState(false);
  const [destFolderUrl, setDestFolderUrl] = useState<string>("");

  // v2 walkthrough state (v2-edit view): walked from the overview's v2 side.
  const [reviewRules, setReviewRules] = useState<FolderRuleSummary[]>([]);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewRuleLoading, setReviewRuleLoading] = useState(false);

  // Folder overview state (folder-overview view): the loaded folder's two sides.
  const [overviewFolderUrl, setOverviewFolderUrl] = useState<string>("");
  const [classified, setClassified] = useState<ClassifiedFolderRules | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  // Rules created in this session get a "created" chip on the v2 side.
  const [sessionCreatedUids, setSessionCreatedUids] = useState<Set<string>>(new Set());

  // v2 in-place edit state (v2-edit view).
  const [v2EditTarget, setV2EditTarget] = useState<V2EditTarget | null>(null);
  const [v2EditSaving, setV2EditSaving] = useState(false);
  const [v2EditError, setV2EditError] = useState<string | null>(null);
  // Per-rule "Saved ✓" after an in-place save, shown on the v2 side rows.
  const [reviewEditStatus, setReviewEditStatus] = useState<Record<string, string>>({});

  const formRef = useRef<StandardFormRef>(null);

  const isFolderMode = folderRules != null && folderRules.length > 0;

  // One guard for both wizard entry paths (v1 startV1Wizard awaits `loading`,
  // v2 startV2Walkthrough awaits reviewRuleLoading): a second overview Edit
  // click while a load is in flight must not start a concurrent load — two
  // racing loads can pair rule A's content with rule B's header.
  const editingBlocked = loading || reviewRuleLoading;

  const setLinkTarget = (target: DeepLinkTarget | null) => {
    setLinkTargetState(target);
    try {
      window.history.replaceState(window.history.state, "", hrefWithTarget(window.location.href, target));
    } catch {
      // Address bar not updated; in-app state is still correct.
    }
  };

  const openTarget = (target: DeepLinkTarget) => {
    if (target.kind === "rule") return handleLoadRule(target.url);
    if (target.kind === "rules") return handleLoadRuleList(target.urls);
    return handleLoadFolder(target.url);
  };

  // Open the link once on page load. Without a session the load answers 401,
  // the login view shows, and handleLogin reopens the target.
  useEffect(() => {
    if (linkOpened.current) return;
    linkOpened.current = true;
    if (initialLink.status === "ok") {
      void openTarget(initialLink.target);
    } else {
      // No link (or a bad one, already shown as the error): plain paste box.
      setLinkTarget(null);
    }
  }, []);

  const handleLogin = () => {
    sessionLost.current = false;
    setView("load");
    setError(null);
    if (linkTarget) void openTarget(linkTarget);
  };

  // Any API request answered 401: the backend session is gone (expired or
  // backend restarted) — land on the login view with a clear message
  // instead of a raw error. State resets like a logout.
  setUnauthorizedHandler(() => {
    sessionLost.current = true;
    setView("login");
    setError("Session expired or invalid. Please log in again.");
    setEvaluation(null);
    setFolderRules(null);
    setFolderIndex(0);
    setNoticeRule(null);
    setOperator(undefined);
    setDrafts({});
    setCloneResults([]);
    setCreatedRuleUids(new Set());
    setReviewRules([]);
    setReviewError(null);
    setV2EditTarget(null);
    setV2EditError(null);
    setClassified(null);
    setSessionCreatedUids(new Set());
  });

  const handleLogout = () => {
    // Destroy the SERVER session too — it holds the Grafana password.
    // Fire-and-forget: sign-out must proceed even if the call fails.
    void logout().catch(() => {});
    setLinkTarget(null);
    setView("login");
    setEvaluation(null);
    setError(null);
    setFolderRules(null);
    setFolderIndex(0);
    setNoticeRule(null);
    setOperator(undefined);
    setDrafts({});
    setSchema(null);
    setCloneResults([]);
    setCreatedRuleUids(new Set());
    setReviewRules([]);
    setReviewError(null);
    setV2EditTarget(null);
    setV2EditError(null);
    setClassified(null);
    setOverviewFolderUrl("");
    setOverviewError(null);
    setSessionCreatedUids(new Set());
  };

  const resetFormState = () => {
    setError(null);
    setCloneError(null);
    setCloneResults([]);
  };

  // "Done"/"Back" from a form: if the session is anchored to a folder
  // (started from the overview), return there; the overview refetches so
  // created/deleted rules show up immediately. Otherwise go to the load view.
  const handleReturnFromForm = () => {
    setEvaluation(null);
    setSyntheticEvaluation(null);
    setFolderRules(null);
    setFolderIndex(0);
    setListSkipped([]);
    setOperator(undefined);
    setDrafts({});
    setCreatedRuleUids(new Set());
    setCreateFolderUrl("");
    setCreateRuleTitle("");
    setCreateRuleCreated(false);
    setDestFolderUrl("");
    resetFormState();
    if (overviewFolderUrl) {
      setView("folder-overview");
      void refreshOverview();
    } else {
      setLinkTarget(null);
      setView("load");
    }
  };

  const handleBackFromV2EditToOverview = () => {
    setV2EditTarget(null);
    setV2EditError(null);
    if (overviewFolderUrl) {
      setView("folder-overview");
      void refreshOverview();
    } else {
      setLinkTarget(null);
      setView("load");
    }
  };

  const ensureSchema = async () => {
    if (schema) return schema;
    const data = await fetchStandardSchema();
    setSchema(data);
    return data;
  };

  // Loads a rule; resolves the EvaluateResponse on success or null on
  // failure (error state is set here; null lets callers fall back to a
  // previous view without reading the racy `error` closure).
  const loadRuleBySummary = async (
    summary: FolderRuleSummary
  ): Promise<EvaluateResponse | { failed: true; message: string } | null> => {
    resetFormState();
    setLoading(true);
    try {
      const [result, schemaData] = await Promise.all([loadRule(summary.rule_url), ensureSchema()]);
      setEvaluation(result);
      if (!schema) setSchema(schemaData);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load rule";
      setError(message);
      return { failed: true, message };
    } finally {
      setLoading(false);
    }
  };

  const handleLoadRule = async (ruleUrl: string) => {
    // A pasted UID has no URL to keep in the address bar.
    setLinkTarget(isHttpUrl(ruleUrl) ? { kind: "rule", url: ruleUrl } : null);
    setFolderRules(null);
    setFolderIndex(0);
    setOperator(undefined);
    setDrafts({});
    setCreatedRuleUids(new Set());
    const result = await loadRuleBySummary({ uid: "", title: "", rule_url: ruleUrl });
    if (result && !("failed" in result)) {
      targetShown.current = true;
      setOperator(extractOperator(result));
      // Single rule by URL (plan §7.3): reviewing is legitimate, so the form
      // opens normally. A migrated rule gets a warning banner above the form.
      setView("operator");
    }
  };

  // Several rules from one link: walked like a folder ("Rule 1 of N",
  // Previous/Next, Create all). The backend leaves out rules that can't be
  // migrated and says why.
  const handleLoadRuleList = async (ruleUrls: string[]) => {
    setLinkTarget({ kind: "rules", urls: ruleUrls });
    resetFormState();
    setFolderRules(null);
    setFolderIndex(0);
    setOperator(undefined);
    setDrafts({});
    setCreatedRuleUids(new Set());
    setListSkipped([]);
    setLoading(true);
    let list;
    try {
      list = await loadRuleList(ruleUrls);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rules");
      setLoading(false);
      return;
    }
    setLoading(false);
    setListSkipped(list.skipped);
    if (list.rules.length === 0) {
      setError("None of the rules in this link can be migrated. See the reasons below.");
      return;
    }
    // Two links to the same rule (/view vs /edit) would share one form.
    const rules = list.rules.filter((r, i, all) => all.findIndex((o) => o.uid === r.uid) === i);
    setFolderRules(rules);
    targetShown.current = true;
    const first = rules[0];
    const result = await loadRuleBySummary(first);
    if (result && !("failed" in result)) {
      setOperator(extractOperator(result));
      setView("operator");
    } else if (!sessionLost.current) {
      // Same fallback as a failed Previous/Next: the notice card shows the
      // error and keeps the nav to the other rules.
      setNoticeRule(first);
      setView("migrated-notice");
    }
  };

  const handleViewEntireFolder = async () => {
    if (!evaluation?.folder_uid) return;
    const previous = linkTarget;
    const ruleUrl = previous?.kind === "rule" ? previous.url : undefined;
    const loaded = await handleLoadFolder(folderUrlFor(evaluation.folder_uid, ruleUrl));
    if (loaded) {
      // The folder walk starts clean; the policy stays, as it's per session.
      setEvaluation(null);
      setDrafts({});
      setCreatedRuleUids(new Set());
      setDestFolderUrl("");
    } else if (!sessionLost.current) {
      // Refresh and re-login should reopen the rule, not the failed folder.
      setLinkTarget(previous);
    }
  };

  // "Load into migration form" from the v2 review view is replaced by the
  // in-place Edit flow (handleEditReviewRule → v2-edit view).

  const handleLoadFolder = async (folderUrl: string): Promise<boolean> => {
    setLinkTarget(isHttpUrl(folderUrl) ? { kind: "folder", url: folderUrl } : null);
    resetFormState();
    setLoading(true);
    try {
      const result = await loadFolderClassified(folderUrl);
      setClassified(result);
      setOverviewFolderUrl(folderUrl);
      setOverviewError(null);
      setSessionCreatedUids(new Set());
      setLoading(false);
      targetShown.current = true;
      setView("folder-overview");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load folder");
      setLoading(false);
      return false;
    }
  };

  // Refresh the overview after a delete; keeps both sides current.
  const refreshOverview = async () => {
    if (!overviewFolderUrl) return;
    setOverviewLoading(true);
    try {
      const result = await loadFolderClassified(overviewFolderUrl);
      setClassified(result);
      setOverviewError(null);
    } catch (err) {
      setOverviewError(err instanceof Error ? err.message : "Failed to refresh folder");
    } finally {
      setOverviewLoading(false);
    }
  };

  // Edit on either side enters that rule's flow at its position: v1 rules go
  // through the full migration wizard (Previous/Next, Create-all at the end),
  // v2 rules through the in-place Save-only walkthrough. Guarded against
  // double-clicks: starting a new entry clears the previous rule's data first,
  // so two in-flight loads can't put rule A's content under rule B's header.
  const handleEditOverviewRule = async (summary: FolderRuleSummary) => {
    if (editingBlocked) return;
    setEvaluation(null);
    resetFormState();
    const v2Index = classified?.v2.findIndex((r) => r.uid === summary.uid) ?? -1;
    if (v2Index >= 0) {
      await startV2Walkthrough(v2Index);
      return;
    }
    const v1Index = classified?.v1.findIndex((r) => r.uid === summary.uid) ?? -1;
    if (v1Index >= 0) {
      await startV1Wizard(v1Index);
      return;
    }
    // Rule not in the classified lists anymore (e.g. list is stale) — refresh
    // and fall back to single-rule edit. A failed load surfaces on the
    // overview (staying there, since no wizard view was entered).
    const result = await loadRuleBySummary(summary);
    if (result && !("failed" in result)) {
      setOperator(extractOperator(result));
      setView("operator");
    } else if (result) {
      setOverviewError(result.message);
    }
  };

  // Delete from either side of the overview.
  const handleDeleteOverviewRule = async (uid: string) => {
    setOverviewError(null);
    try {
      await deleteRuleView(uid);
    } catch (err) {
      // 404 on a race (someone else deleted first) is fine — fall through to refresh.
      const message = err instanceof Error ? err.message : "Failed to delete rule";
      if (!message.toLowerCase().includes("not found")) {
        setOverviewError(message);
        await refreshOverview();
        return;
      }
      setOverviewError("Rule was already deleted; refreshing list.");
    }
    await refreshOverview();
  };

  // Leave the folder overview for the load view (load a different folder/rule).
  const handleBackToLoadFromOverview = () => {
    setLinkTarget(null);
    setView("load");
    setClassified(null);
    setOverviewFolderUrl("");
    setOverviewError(null);
    setSessionCreatedUids(new Set());
  };

  // Enter the v1 migration wizard at a given v1 rule index (0 for the "v1"
  // button): operator page first, Previous/Next nav, destination folder and
  // Create-all at the end — exactly as the folder wizard always worked.
  const startV1Wizard = async (index: number) => {
    if (!classified || classified.v1.length === 0) return;
    const clamped = Math.max(0, Math.min(index, classified.v1.length - 1));
    setFolderRules(classified.v1);
    setFolderIndex(clamped);
    setDrafts({});
    setCreatedRuleUids(new Set());
    // Migrated rules land on the notice card, not the operator page (§7.2).
    // The session operator is NOT cleared here: a user who already picked a
    // policy re-entering on a migrated rule keeps their choice for the
    // rules they walk to next.
    if (classified.v1[clamped].migrated) {
      setEvaluation(null);
      setNoticeRule(classified.v1[clamped]);
      setView("migrated-notice");
      return;
    }
    const result = await loadRuleBySummary(classified.v1[clamped]);
    if (result && !("failed" in result)) {
      // Session operator already chosen (e.g. inside a wizard walk) → skip
      // the selector and go straight to the form.
      if (!operator) setOperator(extractOperator(result));
      setView(operator ? "form" : "operator");
    } else if (result) {
      // Failed load: surface the error on the overview instead of a silent
      // no-op (FolderOverview only shows overviewError, not App's `error`).
      setOverviewError(result.message);
    }
  };

  // Enter the v2 walkthrough at a given v2 rule index: Edit directly, no
  // operator page — the policy is a dropdown among the form fields.
  const startV2Walkthrough = async (index: number) => {
    if (!classified || classified.v2.length === 0) return;
    const clamped = Math.max(0, Math.min(index, classified.v2.length - 1));
    setReviewRules(classified.v2);
    setReviewIndex(clamped);
    setReviewError(null);
    setReviewEditStatus({});
    setV2EditTarget(null);
    setV2EditError(null);
    setReviewRuleLoading(true);
    setView("v2-edit");
    try {
      const target = await loadV2EditTarget(classified.v2[clamped]);
      setV2EditTarget(target);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "Failed to load rule");
    } finally {
      setReviewRuleLoading(false);
    }
  };

  // Fetch a v2 rule and shape it for the edit form.
  const loadV2EditTarget = async (summary: FolderRuleSummary): Promise<V2EditTarget> => {
    // Fetch the full rule content through the compliance-backed load
    // endpoint (user's own credentials, no admin needed to view).
    const result = await loadRule(summary.rule_url);
    // Rebuild the rule's labels/annotations from the verdicts.
    const schemaNames = new Set(result.fields.map((f) => f.name));
    const labels: Record<string, string> = {};
    const annotations: Record<string, string> = {};
    const extraLabels: Record<string, string> = {};
    const extraAnnotations: Record<string, string> = {};
    for (const field of result.fields) {
      if (field.observed_value == null) continue;
      if (field.name === "Appchi-$operator") {
        labels[field.observed_value] = "true";
        continue;
      }
      if (field.location === "label") labels[field.name] = field.observed_value;
      else annotations[field.name] = field.observed_value;
      
    }
    if (labels["Send-Alert"] == null) labels["Send-Alert"] = "true";
    // The verdicts only cover schema fields; anything else the rule carries
    // (e.g. custom labels) must ride along untouched or an in-place save
    // would silently delete it.
    for (const [key, value] of Object.entries(labels)) {
      // The current operator label key ("Appchi - <name>") is not a schema field
      // name but is schema-managed anyway — never treat it as an extra; the form
      // clears it when the operator changes.
      if (key.startsWith("Appchi - ")) continue;
      if (!schemaNames.has(key) && key !== "Send-Alert") extraLabels[key] = value;
    }
    for (const [key, value] of Object.entries(annotations)) {
      if (!schemaNames.has(key)) extraAnnotations[key] = value;
    }
    return {
      uid: summary.uid,
      title: result.rule_title || summary.title,
      rule_url: summary.rule_url,
      labels,
      annotations,
      extraLabels,
      extraAnnotations,
    };
  };

  const goToReviewRule = async (index: number) => {
    if (!reviewRules.length || index < 0 || index >= reviewRules.length) return;
    setReviewError(null);
    setV2EditError(null);
    // Drop the old rule's values BEFORE navigating: a failed fetch must never
    // leave the form holding rule A's data under rule B's header (a Save
    // would PUT rule A's content to rule B).
    setV2EditTarget(null);
    setReviewIndex(index);
    setReviewRuleLoading(true);
    try {
      const target = await loadV2EditTarget(reviewRules[index]);
      setV2EditTarget(target);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "Failed to load rule");
    } finally {
      setReviewRuleLoading(false);
    }
  };

  const handleSaveV2Edit = async (payload: {
    title: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    clearAnnotations?: string[];
    clearLabels?: string[];
  }) => {
    if (!v2EditTarget) return;
    setV2EditError(null);
    setV2EditSaving(true);
    try {
      const result = await updateRuleView(v2EditTarget.uid, payload);
      // Stay in the walkthrough on the saved rule; tick the per-rule status
      // that the overview's v2 side shows when you go back.
      setReviewEditStatus((prev) => ({ ...prev, [v2EditTarget.uid]: "Saved ✓" }));
      // Re-load the saved rule so the next save (operator Boaz → Casim in
      // the same walkthrough) derives clearLabels from the rule's REAL
      // label keys — saving #2 with a stale loadedOperatorKey would no-op
      // the clear and orphan the previous operator label, leaving the rule
      // evaluating against the old team's policy.
      const ruleUrl = result.rule_url || v2EditTarget.rule_url;
      if (ruleUrl) {
        setReviewRuleLoading(true);
        try {
          const refreshed = await loadV2EditTarget({ ...v2EditTarget, rule_url: ruleUrl });
          setV2EditTarget(refreshed);
        } catch {
          // Refresh is best-effort; the saved rule itself is fine.
        } finally {
          setReviewRuleLoading(false);
        }
      }
    } catch (err) {
      setV2EditError(err instanceof Error ? err.message : "Failed to save rule");
    } finally {
      setV2EditSaving(false);
    }
  };

  // "← Back" from the v2 edit form returns to the overview (refreshed).
  const handleBackFromV2Edit = () => {
    handleBackFromV2EditToOverview();
  };

  const saveCurrentDraft = () => {
    if (!evaluation || !formRef.current) return;
    const values = formRef.current.getValues();
    setDrafts((prev) => ({ ...prev, [evaluation.rule_uid]: { values } }));
  };

  // Same stale-target guard as the v2 walkthrough: drop the old rule's
  // evaluation BEFORE navigating so a slow/failed load can never leave rule
  // A's form content under rule B's header (a Create click in that window
  // would clone the wrong rule).
  const goToRule = (index: number) => {
    if (!folderRules || index < 0 || index >= folderRules.length) return;
    if (loading) return;
    saveCurrentDraft();
    setEvaluation(null);
    // Capture the rule the user was ON before advancing: if the target's
    // load fails we restore the notice card for THIS rule, and the header
    // numbering must therefore also roll back to this index. Without the
    // rollback below, a failed Previous/Next left "Rule {failedIndex+1} of
    // N" next to the previous rule's title.
    const originIndex = folderIndex;
    setFolderIndex(index);
    // Migrated rules show the notice card instead of the form (§7.2); the
    // operator choice is kept so "Migrate again" can open the form directly.
    if (folderRules[index].migrated) {
      setSyntheticEvaluation(null);
      setNoticeRule(folderRules[index]);
      setView("migrated-notice");
      return;
    }
    setNoticeRule(null);
    void loadRuleBySummary(folderRules[index]).then((result) => {
      // Navigating out of the notice card into an editable rule must also
      // switch the view back — staying on "migrated-notice" with a null
      // noticeRule renders nothing (blank screen). On failure, fall back to
      // the rule the user was ON (the notice rule), reachable via the saved
      // index captured before the load started.
      if (result && !("failed" in result)) {
        // The policy is a session-wide choice (OperatorSelector copy says it
        // applies to all rules in the session): once chosen, don't re-ask on
        // every Previous/Next. Only extract a per-rule operator when there
        // isn't one yet — otherwise it would override the user's pick.
        if (!operator) setOperator(extractOperator(result));
        setView(operator ? "form" : "operator");
      } else {
        // Load failed: roll the index back so the header reads "Rule
        // {originIndex+1} of N" against the rule we actually restored, and
        // return to the notice card (with the error shown) so the nav
        // buttons stay reachable to retry.
        setFolderIndex(originIndex);
        setNoticeRule(folderRules[originIndex]);
      }
    });
  };

  const handleConfirmOperator = (selectedOperator: string) => {
    setOperator(selectedOperator);
    setView("form");
  };

  // "Open anyway" from the notice card (§3.3 warn-but-allow): open the
  // normal form for this single rule.
  const handleMigrateAgain = () => {
    const rule = folderRules?.[folderIndex];
    if (!rule) return;
    setNoticeRule(null);
    void loadRuleBySummary(rule).then((result) => {
      if (result && !("failed" in result)) {
        // Session operator already chosen beats the rule's own stale label.
        if (!operator) setOperator(extractOperator(result));
        // Same routing as goToRule: a migrated rule can be the FIRST rule
        // opened in a session, so no operator may be chosen yet — the form
        // must not open with an empty policy. The operator page asks once;
        // when a choice exists it is kept (no re-ask, CR round 4).
        setView(operator ? "form" : "operator");
      } else {
        setNoticeRule(rule);
      }
    });
  };

  const handleCreateClone = async (
    labels: Record<string, string>,
    annotations: Record<string, string>,
    folderUrl?: string
  ) => {
    if (!evaluation) return;
    setCloneError(null);
    setCloneResults([]);
    setCloneLoading(true);
    try {
      const result = await cloneRule(evaluation.rule_uid, labels, annotations, folderUrl);
      setCloneResults([result]);
      setCreatedRuleUids((prev) => new Set(prev).add(evaluation.rule_uid));
      setSessionCreatedUids((prev) => new Set(prev).add(result.rule_uid));
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : "Clone failed");
    } finally {
      setCloneLoading(false);
    }
  };

  const handleCreateCloneAndDelete = async (
    labels: Record<string, string>,
    annotations: Record<string, string>,
    folderUrl?: string
  ) => {
    if (!evaluation) return;
    setCloneError(null);
    setCloneResults([]);
    setCloneLoading(true);
    try {
      const result = await cloneAndDeleteRule(evaluation.rule_uid, labels, annotations, folderUrl);
      setCloneResults([result]);
      setCreatedRuleUids((prev) => new Set(prev).add(evaluation.rule_uid));
      setSessionCreatedUids((prev) => new Set(prev).add(result.rule_uid));
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : "Clone and delete failed");
    } finally {
      setCloneLoading(false);
    }
  };

  const handleStartCreateRule = () => {
    setLinkTarget(null);
    setView("create-input");
    setError(null);
    setCreateFolderUrl("");
    setCreateRuleTitle("");
    setCreateRuleCreated(false);
  };

  const handleCreateInputSubmit = async (folderUrl: string, title: string, selectedOperator: string) => {
    setCreateFolderUrl(folderUrl);
    setCreateRuleTitle(title);
    setOperator(selectedOperator);
    setView("create-form");

    let schemaData: StandardSchema;
    try {
      const [sd] = await Promise.all([
        schema ?? fetchStandardSchema(),
        selectedOperator ? Promise.resolve() : Promise.reject(new Error("Notification policy is required")),
      ]);
      schemaData = sd;
    } catch (err) {
      // A rejected schema fetch (or missing policy) must not leave the
      // create-form view permanently blank: fall back to the load view with
      // the error visible (same pattern as handleLoadFolder).
      setError(err instanceof Error ? err.message : "Failed to create rule");
      setView("load");
      return;
    }
    if (!schema) setSchema(schemaData);

    const emptyFields: EvaluateResponse["fields"] = schemaData.fields.map((field) => ({
      name: field.name,
      location: field.location,
      status: "NON_COMPLIANT" as const,
      observed_value: field.name === "Appchi-$operator" ? selectedOperator : null,
      expected_value: field.default_value,
      default_value: field.default_value,
      reason_code: "FIELD_EMPTY",
      message: field.explanation,
    }));

    setSyntheticEvaluation({
      rule_uid: "new-rule",
      rule_title: title,
      standard_version: schemaData.version,
      overall_status: "NON_COMPLIANT",
      fields: emptyFields,
    });
  };

  const handleCreateRuleSubmit = async (
    labels: Record<string, string>,
    annotations: Record<string, string>
  ) => {
    if (!createFolderUrl || !createRuleTitle) return;
    setCloneError(null);
    setCloneResults([]);
    setCloneLoading(true);
    try {
      const result = await createRule(createFolderUrl, createRuleTitle, labels, annotations);
      setCloneResults([{ ...result, action: result.action as "created" | "updated" }]);
      setCreateRuleCreated(true);
      setCreatedRuleUids((prev) => new Set(prev).add(result.rule_uid));
      setSessionCreatedUids((prev) => new Set(prev).add(result.rule_uid));
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : "Create rule failed");
    } finally {
      setCloneLoading(false);
    }
  };

  // Batch boundary (plan §7.2): "Create all rules" covers the not-migrated
  // rules only — the card is offered on the last not-migrated rule and
  // disappears from the first migrated rule onward. Filter by the flag at
  // click time (not by index) so a mid-walk re-migration is excluded too;
  // a stale snapshot that already contains a re-migrated rule is still
  // backed up by the backend's click-time 409.
  const batchRules = folderRules?.filter((r) => !r.migrated) ?? [];

  const prepareFolderDrafts = (): Record<string, RuleDraft> | null => {
    if (!folderRules || !schema) return null;
    saveCurrentDraft();

    const updatedDrafts = { ...drafts };
    if (evaluation && formRef.current) {
      updatedDrafts[evaluation.rule_uid] = { values: formRef.current.getValues() };
    }

    const missingByRule: { title: string; index: number; fields: string[] }[] = [];

    for (let i = 0; i < batchRules.length; i++) {
      const rule = batchRules[i];
      const draft = updatedDrafts[rule.uid];
      // Number errors by the rule's position in the FULL folder list (what
      // the wizard header shows), not the filtered batch list.
      const folderIndex = folderRules.findIndex((r) => r.uid === rule.uid);
      if (!draft) {
        missingByRule.push({ title: rule.title, index: folderIndex, fields: ["not edited yet"] });
        continue;
      }
      const errors = validateFormValues(draft.values, schema);
      if (errors.length > 0) {
        missingByRule.push({ title: rule.title, index: folderIndex, fields: errors });
      }
    }

    if (missingByRule.length > 0) {
      const messages = missingByRule.map(
        (r) => `rule ${r.index + 1} (${r.title}) - ${r.fields.join(", ")}`
      );
      setCloneError(messages.join("; "));
      return null;
    }

    return updatedDrafts;
  };

  const handleCreateAllRules = async () => {
    const updatedDrafts = prepareFolderDrafts();
    if (!updatedDrafts) return;

    setCloneError(null);
    setCloneResults([]);
    setCloneLoading(true);

    const results: CloneResult[] = [];
    const createdOriginals: string[] = [];
    const failures: { title: string; error: string }[] = [];

    for (let i = 0; i < batchRules.length; i++) {
      const rule = batchRules[i];
      const draft = updatedDrafts[rule.uid];
      try {
        const { labels, annotations } = buildRulePayload(draft.values, schema!);
        const result = await cloneRule(rule.uid, labels, annotations, destFolderUrl || undefined);
        results.push(result);
        createdOriginals.push(rule.uid);
        setSessionCreatedUids((prev) => new Set(prev).add(result.rule_uid));
      } catch (err) {
        failures.push({
          title: rule.title,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    setCloneResults(results);
    if (createdOriginals.length > 0) {
      // Store ORIGINAL uids here (id space of folderRules/createdRuleUids is
      // the original rule; the copy uids live in sessionCreatedUids).
      setCreatedRuleUids((prev) => {
        const next = new Set(prev);
        createdOriginals.forEach((uid) => next.add(uid));
        return next;
      });
    }
    if (failures.length > 0) {
      setCloneError(
        failures.map((f) => `${f.title}: ${f.error}`).join("; ")
      );
    }
    setCloneLoading(false);
  };

  const handleCreateAllRulesAndDelete = async () => {
    const updatedDrafts = prepareFolderDrafts();
    if (!updatedDrafts) return;

    setCloneError(null);
    setCloneResults([]);
    setCloneLoading(true);

    const results: CloneResult[] = [];
    const createdOriginals: string[] = [];
    const failures: { title: string; error: string }[] = [];

    for (let i = 0; i < batchRules.length; i++) {
      const rule = batchRules[i];
      const draft = updatedDrafts[rule.uid];
      try {
        const { labels, annotations } = buildRulePayload(draft.values, schema!);
        const result = await cloneAndDeleteRule(rule.uid, labels, annotations, destFolderUrl || undefined);
        results.push(result);
        createdOriginals.push(rule.uid);
        setSessionCreatedUids((prev) => new Set(prev).add(result.rule_uid));
      } catch (err) {
        failures.push({
          title: rule.title,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    setCloneResults(results);
    if (createdOriginals.length > 0) {
      setCreatedRuleUids((prev) => {
        const next = new Set(prev);
        createdOriginals.forEach((uid) => next.add(uid));
        return next;
      });
    }
    if (failures.length > 0) {
      setCloneError(
        failures.map((f) => `${f.title}: ${f.error}`).join("; ")
      );
    }
    setCloneLoading(false);
  };

  const currentDraft = evaluation ? drafts[evaluation.rule_uid]?.values : undefined;

  // The notice view is mounted on a folder rule under two circumstances:
  // 1. the rule is genuinely migrated (flag from the last folder load), or
  // 2. a load failure fell back to it — never claim "migrated" there. The
  //    snapshot's `migrated` flag on the rule itself is the signal; while a
  //    load is in flight the loading copy shows instead.
  const noticeMigrated = noticeRule?.migrated === true;

  // Login-page line when a rule/folder is waiting to open. The rule's name is
  // never taken from the link: anyone can edit a link.
  const fromInitialLink =
    !targetShown.current &&
    initialLink.status === "ok" &&
    JSON.stringify(initialLink.target) === JSON.stringify(linkTarget);
  const loginNotice = linkTarget
    ? (fromInitialLink ? LINK_LOGIN_NOTICE : REOPEN_LOGIN_NOTICE)[linkTarget.kind]
    : undefined;

  const listMode = linkTarget?.kind === "rules";
  const skippedCard = listMode && listSkipped.length > 0 && (
    <div className="card">
      <h3>
        {listSkipped.length} rule{listSkipped.length === 1 ? "" : "s"} from your link left out
      </h3>
      <ul>
        {listSkipped.map((s) => (
          <li key={s.rule_url}>
            {s.message} <span className="help-text">({s.rule_url})</span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Alerts on Standard</h1>
          <span className="subtitle">Guided alert rule migration</span>
        </div>
        {view !== "login" && (
          <button onClick={handleLogout} className="secondary">
            Sign out
          </button>
        )}
      </header>
      <main>
        {view === "login" && <LoginForm onLogin={handleLogin} notice={loginNotice} />}
        {view === "load" && (
          <>
            <RuleUrlInput
              onLoad={handleLoadRule}
              onLoadFolder={handleLoadFolder}
              loading={loading}
            />
            <div className="card create-new-option">
              <h3>Create a brand-new v2 rule</h3>
              <p className="help-text">
                Instead of migrating an existing rule, create a new v2 alert rule skeleton in a folder and fill in the standard fields.
              </p>
              <button onClick={handleStartCreateRule} className="secondary">
                Create new v2 rule
              </button>
            </div>
            {error && <div className="card error">{error}</div>}
            {skippedCard}
          </>
        )}
        {view === "create-input" && (
          <CreateRuleInput
            onSubmit={handleCreateInputSubmit}
            onCancel={() => setView("load")}
            loading={loading}
          />
        )}
        {view === "folder-overview" && (
          <FolderOverview
            v1={classified?.v1 ?? []}
            v2={classified?.v2 ?? []}
            loading={overviewLoading || loading}
            error={overviewError}
            createdUids={sessionCreatedUids}
            editStatus={reviewEditStatus}
            editDisabled={editingBlocked}
            onEditRule={handleEditOverviewRule}
            onDeleteRule={handleDeleteOverviewRule}
            onBack={handleBackToLoadFromOverview}
          />
        )}
        {view === "v2-edit" && (
          <>
            <div className="card folder-nav">
              <div className="folder-nav-header">
                <span>
                  Rule {reviewIndex + 1} of {reviewRules.length}
                </span>
                <strong>{reviewRules[reviewIndex]?.title}</strong>
              </div>
              <div className="folder-nav-buttons">
                <button
                  type="button"
                  onClick={() => goToReviewRule(reviewIndex - 1)}
                  disabled={reviewIndex === 0 || reviewRuleLoading}
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => goToReviewRule(reviewIndex + 1)}
                  disabled={reviewIndex === reviewRules.length - 1 || reviewRuleLoading}
                >
                  Next
                </button>
              </div>
            </div>
            {reviewError && <div className="card error">{reviewError}</div>}
            {reviewRuleLoading && !v2EditTarget && (
              <div className="card">Loading rule...</div>
            )}
            {v2EditTarget && (
              <V2EditForm
                uid={v2EditTarget.uid}
                title={v2EditTarget.title}
                labels={v2EditTarget.labels}
                annotations={v2EditTarget.annotations}
                extraLabels={v2EditTarget.extraLabels}
                extraAnnotations={v2EditTarget.extraAnnotations}
                saveError={v2EditError}
                saving={v2EditSaving}
                onSave={handleSaveV2Edit}
                onBack={handleBackFromV2Edit}
              />
            )}
          </>
        )}
        {view === "operator" && (
          <OperatorSelector defaultOperator={operator} onConfirm={handleConfirmOperator} />
        )}
        {view === "migrated-notice" && noticeRule && (
          <>
            {overviewFolderUrl && (
              <div className="form-back">
                <button type="button" onClick={handleReturnFromForm} className="secondary">
                  ↩︎ Back to folder
                </button>
              </div>
            )}
            {folderRules && (
              <div className="card folder-nav">
                <div className="folder-nav-header">
                  <span>
                    Rule {folderIndex + 1} of {folderRules.length}
                  </span>
                  <strong>{noticeRule.title}</strong>
                </div>
                <div className="folder-nav-buttons">
                  <button
                    type="button"
                    onClick={() => goToRule(folderIndex - 1)}
                    disabled={folderIndex === 0 || loading}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => goToRule(folderIndex + 1)}
                    disabled={folderIndex === folderRules.length - 1 || loading}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            {skippedCard}
            <div className="card migrated-notice">
              {loading ? (
                <>
                  <h3>Loading rule…</h3>
                  <p className="help-text">Fetching the rule from Grafana.</p>
                </>
              ) : !noticeMigrated ? (
                <>
                  {/* Reached only from a failed load fallback: this rule is
                      NOT migrated — the notice card is just where we landed.
                      Say what actually happened instead of the migrated copy. */}
                  <h3>Could not load this rule.</h3>
                  {error && <p className="help-text danger-text">{error}</p>}
                  <p className="help-text">
                    Use Previous / Next to continue, or retry with "Open anyway".
                  </p>
                </>
              ) : (
                <>
                  <h3>Already migrated — nothing to fill.</h3>
                  <p className="help-text">
                    This rule has already been migrated by this tool.
                  </p>
                </>
              )}
              <div className="clone-buttons">
                <button type="button" className="secondary" onClick={handleMigrateAgain}>
                  Open anyway
                </button>
              </div>
            </div>
            {error && <div className="card error">{error}</div>}
          </>
        )}
        {view === "create-form" && syntheticEvaluation && (
          <>
            <StandardForm
              ref={formRef}
              evaluation={syntheticEvaluation}
              onCreateClone={handleCreateRuleSubmit}
              onReturn={handleReturnFromForm}
              cloneLoading={cloneLoading}
              cloneError={cloneError}
              operator={operator}
              isCreateMode
              ruleCreated={createRuleCreated}
            />
            {cloneResults.length > 0 && (
              <div className="card clone-result">
                <h3>New rule created</h3>
                <p>
                  <strong>{cloneResults[0].title}</strong>
                </p>
                <p>
                  <a href={cloneResults[0].rule_url} target="_blank" rel="noopener noreferrer">
                    {cloneResults[0].rule_url}
                  </a>
                </p>
              </div>
            )}
          </>
        )}
        {/* form view stays mounted during an in-flight rule load (loading)
            so Previous/Next never blank the screen; the loading card shows
            instead of the form until the new rule arrives. */}
        {(view === "form" && (evaluation || (isFolderMode && loading))) && (
          <>
            {/* Warn-but-allow on a single migrated rule load (plan §3.3/§7.3). */}
            {!isFolderMode && evaluation?.migrated && (
              <div className="card error">
                This rule has already been migrated by this tool.
              </div>
            )}
            {isFolderMode && folderRules && (
              <div className="card folder-nav">
                <div className="folder-nav-header">
                  <span>
                    Rule {folderIndex + 1} of {folderRules.length}
                  </span>
                  <strong>{folderRules[folderIndex].title}</strong>
                </div>
                <div className="folder-nav-buttons">
                  <button
                    type="button"
                    onClick={() => goToRule(folderIndex - 1)}
                    disabled={folderIndex === 0 || loading}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => goToRule(folderIndex + 1)}
                    disabled={folderIndex === folderRules.length - 1 || loading}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            {skippedCard}
            {/* "View entire folder" failed: the rule's form stays open. */}
            {!isFolderMode && evaluation && error && <div className="card error">{error}</div>}
            {/* Rule load in flight or failed: evaluation is null, the form
                can't render — show loading/error with the nav intact. */}
            {!evaluation && loading && <div className="card">Loading rule...</div>}
            {!evaluation && !loading && error !== null && (
              <div className="card error">{error}</div>
            )}
            {evaluation && (
            <StandardForm
              ref={formRef}
              evaluation={evaluation}
              initialValues={currentDraft}
              onCreateClone={handleCreateClone}
              onCreateCloneAndDelete={handleCreateCloneAndDelete}
              onReturn={handleReturnFromForm}
              cloneLoading={cloneLoading}
              cloneError={cloneError}
              operator={operator}
              isFolderMode={isFolderMode}
              ruleCreated={evaluation ? createdRuleUids.has(evaluation.rule_uid) : false}
              destFolderUrl={destFolderUrl}
              onDestFolderUrlChange={setDestFolderUrl}
              onViewFolder={
                !isFolderMode && evaluation.folder_uid ? () => void handleViewEntireFolder() : undefined
              }
              viewFolderLoading={loading}
            />
            )}
            {/* Batch boundary (§7.2): the batch card sits on the last
                not-migrated rule only — from the first migrated rule onward
                the option doesn't exist. */}
            {isFolderMode &&
              folderRules &&
              !folderRules[folderIndex]?.migrated &&
              batchRules.length > 0 &&
              folderRules[folderIndex]?.uid === batchRules[batchRules.length - 1].uid && (
              <div className="card clone-actions">
                {cloneError && <div className="error">{cloneError}</div>}
                <div className="clone-buttons">
                  <button
                    onClick={handleCreateAllRules}
                    disabled={cloneLoading || createdRuleUids.size >= batchRules.length}
                  >
                    {createdRuleUids.size >= batchRules.length
                      ? "All rules created"
                      : cloneLoading
                      ? "Creating rules..."
                      : "Create all rules"}
                  </button>
                  <button
                    onClick={handleCreateAllRulesAndDelete}
                    disabled={cloneLoading || createdRuleUids.size >= batchRules.length}
                    className="danger"
                  >
                    {createdRuleUids.size >= batchRules.length
                      ? "All rules created & originals deleted"
                      : cloneLoading
                      ? "Creating and deleting..."
                      : "Create all rules & delete originals"}
                  </button>
                </div>
                <p className="help-text">
                  This will create a v2 rule for every not-yet-migrated rule in{" "}
                  {listMode ? "this list" : "the folder"}. The second button also deletes each
                  original rule after its v2 copy is created.
                </p>
                <p className="help-text danger-text">
                  The delete action is destructive and cannot be undone.
                </p>
              </div>
            )}
            {!isFolderMode && cloneResults.length > 0 && (
              <div className="card clone-result">
                <h3>{cloneResults[0].action === "updated" ? "Rule updated" : "New rule created"}</h3>
                <p>
                  <strong>{cloneResults[0].title}</strong>
                </p>
                <p>
                  <a href={cloneResults[0].rule_url} target="_blank" rel="noopener noreferrer">
                    {cloneResults[0].rule_url}
                  </a>
                </p>
              </div>
            )}
            {isFolderMode && cloneResults.length > 0 && (
              <div className="card clone-result">
                <h3>
                  {cloneResults.length} rule(s) created
                  {cloneResults.some((r) => r.original_deleted) && " — originals deleted"}
                </h3>
                <ul>
                  {cloneResults.map((result, idx) => (
                    <li key={idx}>
                      <strong>{result.title}</strong>{" "}
                      <a href={result.rule_url} target="_blank" rel="noopener noreferrer">
                        {result.rule_url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

const LINK_LOGIN_NOTICE: Record<DeepLinkTarget["kind"], string> = {
  rule: "Log in to open the rule you clicked in alerts-bi.",
  rules: "Log in to open the rules you selected in alerts-bi.",
  folder: "Log in to open the folder from your link.",
};

const REOPEN_LOGIN_NOTICE: Record<DeepLinkTarget["kind"], string> = {
  rule: "Log in to reopen the rule you had open.",
  rules: "Log in to reopen the rules you had open.",
  folder: "Log in to reopen the folder you had open.",
};

function extractOperator(evaluation: EvaluateResponse): string | undefined {
  return evaluation.fields.find((f) => f.name === "Appchi-$operator")?.observed_value ?? undefined;
}

export default App;

