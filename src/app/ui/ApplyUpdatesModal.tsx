import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  applyWriteback,
  planWriteback,
  type WritebackPlan,
  type WritebackProgress,
  type WritebackResult,
} from "../core/githubWriteback";
import { usePreferenceStore } from "../store/preferences";

type ApplyUpdatesModalProps = {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  onRequestToken: () => void;
};

const EMPTY_PROGRESS: WritebackProgress = {
  stage: "idle",
  current: 0,
  total: 0,
  failed: 0,
  skipped: 0,
};

export function ApplyUpdatesModal({
  isOpen,
  onClose,
  token,
  onRequestToken,
}: ApplyUpdatesModalProps) {
  const { t } = useTranslation();
  const { preferences, setRefreshBeforeApply } = usePreferenceStore();
  const [plan, setPlan] = useState<WritebackPlan | null>(null);
  const [result, setResult] = useState<WritebackResult | null>(null);
  const [progress, setProgress] = useState<WritebackProgress>(EMPTY_PROGRESS);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState("");
  const requestSeqRef = useRef(0);

  const summary = useMemo(() => {
    const activePlan = result?.plan ?? plan;
    if (!activePlan) return null;
    return {
      actionableRepos: activePlan.actionableRepos,
      unchangedRepos: activePlan.unchangedRepos,
      validTaggedRepos: activePlan.validTaggedRepos,
      unstarredRepos: activePlan.unstarredActionableRepos,
      missingLists: activePlan.missingLists.length,
      createdLists: activePlan.createdLists.length,
    };
  }, [plan, result]);

  useEffect(() => {
    if (!isOpen) {
      requestSeqRef.current += 1;
      setPlan(null);
      setResult(null);
      setProgress(EMPTY_PROGRESS);
      setIsPlanning(false);
      setIsApplying(false);
      setError("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setPlan(null);
      setResult(null);
      setProgress(EMPTY_PROGRESS);
      setIsPlanning(false);
      setError(t("apply.errors.missingPat"));
      return;
    }

    const requestId = ++requestSeqRef.current;
    setIsPlanning(true);
    setError("");
    setResult(null);
    setProgress({
      stage: "preparing_preview",
      current: 0,
      total: 1,
      failed: 0,
      skipped: 0,
    });

    planWriteback({ token: trimmedToken }, {}, setProgress)
      .then((nextPlan) => {
        if (requestId !== requestSeqRef.current) return;
        setPlan(nextPlan);
      })
      .catch((err) => {
        if (requestId !== requestSeqRef.current) return;
        setError((err as Error).message || t("apply.errors.previewFailed"));
      })
      .finally(() => {
        if (requestId !== requestSeqRef.current) return;
        setIsPlanning(false);
      });
  }, [isOpen, token, t]);

  if (!isOpen) return null;

  const ensureToken = (): boolean => {
    if (token.trim()) return true;
    setError(t("apply.errors.missingPat"));
    onRequestToken();
    return false;
  };

  const handleApply = async () => {
    if (!ensureToken()) return;
    if (!preferences.refreshBeforeApply && !plan) {
      setError(t("apply.errors.previewNotReady"));
      return;
    }
    const requestId = ++requestSeqRef.current;
    setIsApplying(true);
    setError("");
    setResult(null);
    setProgress({
      stage: "preparing_writeback",
      current: 0,
      total: 1,
      failed: 0,
      skipped: 0,
    });

    try {
      const nextResult = await applyWriteback(
        { token: token.trim() },
        {
          createMissingListsAsPrivate: false,
          reusePlan: preferences.refreshBeforeApply ? null : plan,
          resolveAutoStarForUnstarred: (unstarredCount) =>
            window.confirm(t("apply.confirmUnstarred", { count: unstarredCount })),
        },
        setProgress
      );
      if (requestId !== requestSeqRef.current) return;
      setResult(nextResult);
      setPlan(nextResult.plan);
    } catch (err) {
      if (requestId !== requestSeqRef.current) return;
      setError((err as Error).message || t("apply.errors.applyFailed"));
    } finally {
      if (requestId !== requestSeqRef.current) return;
      setIsApplying(false);
    }
  };

  const disabled = isPlanning || isApplying;
  const issues = result ? [...result.failed, ...result.skipped] : (plan?.skipped ?? []);
  const changePreviewRows = (result?.plan.candidates ?? plan?.candidates ?? []).slice(0, 80);

  return (
    <div className="drawer" role="dialog" aria-modal="true">
      <div className="drawer-panel settings">
        <button className="panel-close" onClick={onClose} aria-label={t("apply.closeAria")}>
          ✕
        </button>
        <div className="settings-scroll">
          <h3>{t("apply.title")}</h3>
          <p>{t("apply.description")}</p>

          <div className="settings-section">
            <h4>{t("apply.sections.runControls")}</h4>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={preferences.refreshBeforeApply}
                onChange={(event) => setRefreshBeforeApply(event.target.checked)}
                disabled={disabled}
              />
              {t("apply.controls.refreshBeforeApply")}
            </label>
            <p className="helper-text">
              {preferences.refreshBeforeApply
                ? t("apply.controls.refreshOn")
                : t("apply.controls.refreshOff")}
            </p>
            <div className="settings-actions">
              <button className="button primary" onClick={handleApply} disabled={disabled}>
                {isApplying ? t("apply.controls.applying") : t("apply.controls.applyToGithub")}
              </button>
            </div>
          </div>

          <div className="settings-section">
            <h4>{t("apply.sections.progress")}</h4>
            <p className="helper-text">
              {t("common.labels.stage")}: {t(`apply.stage.${progress.stage}`, { defaultValue: progress.stage })}
            </p>
            <p className="helper-text">
              {t("common.labels.progress")}: {progress.current}/{progress.total} · {t("apply.labels.failed")}: {progress.failed} · {t("apply.labels.skipped")}: {progress.skipped}
            </p>
          </div>

          {summary ? (
            <div className="settings-section">
              <h4>{t("apply.sections.planSummary")}</h4>
              <div className="writeback-summary-grid">
                <div className="writeback-summary-item">
                  <span className="writeback-summary-label">{t("apply.labels.actionable")}</span>
                  <span className="writeback-summary-value">{summary.actionableRepos}</span>
                </div>
                <div className="writeback-summary-item">
                  <span className="writeback-summary-label">{t("apply.labels.unchanged")}</span>
                  <span className="writeback-summary-value">{summary.unchangedRepos}</span>
                </div>
                <div className="writeback-summary-item">
                  <span className="writeback-summary-label">{t("apply.labels.validTagged")}</span>
                  <span className="writeback-summary-value">{summary.validTaggedRepos}</span>
                </div>
                <div className="writeback-summary-item">
                  <span className="writeback-summary-label">{t("apply.labels.unstarred")}</span>
                  <span className="writeback-summary-value">{summary.unstarredRepos}</span>
                </div>
                <div className="writeback-summary-item">
                  <span className="writeback-summary-label">{t("apply.labels.missingLists")}</span>
                  <span className="writeback-summary-value">{summary.missingLists}</span>
                </div>
                <div className="writeback-summary-item">
                  <span className="writeback-summary-label">{t("apply.labels.createdLists")}</span>
                  <span className="writeback-summary-value">{summary.createdLists}</span>
                </div>
              </div>
              {plan?.scanFailures ? (
                <p className="helper-text">
                  {t("apply.status.scanFailures", { count: plan.scanFailures })}
                </p>
              ) : null}
            </div>
          ) : null}

          {changePreviewRows.length > 0 ? (
            <div className="settings-section">
              <h4>{t("apply.sections.plannedRepoChanges")}</h4>
              <div className="writeback-preview-list">
                {changePreviewRows.map((row) => (
                  <div className="writeback-preview-item" key={row.repoId}>
                    <div className="writeback-preview-title">{row.repoFullName}</div>
                    <div className="writeback-preview-row">
                      <span className="writeback-preview-label">{t("apply.labels.current")}</span>
                      <span>{row.currentListNames.join(", ") || t("common.values.none")}</span>
                    </div>
                    <div className="writeback-preview-row">
                      <span className="writeback-preview-label">{t("apply.labels.after")}</span>
                      <span>{row.finalListNames.join(", ") || t("common.values.none")}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : plan ? (
            <div className="settings-section">
              <h4>{t("apply.sections.plannedRepoChanges")}</h4>
              <p className="helper-text">{t("apply.status.noChangesDetected")}</p>
            </div>
          ) : null}

          {result ? (
            <div className="settings-section">
              <h4>{t("apply.sections.applyResult")}</h4>
              <p className="helper-text">
                {t("apply.labels.applied")}: {result.applied}
              </p>
              <p className="helper-text">
                {t("apply.labels.locallyUpdated")}: {result.locallyUpdated}
              </p>
              <p className="helper-text">
                {t("apply.labels.failed")}: {result.failed.length}
              </p>
              <p className="helper-text">
                {t("apply.labels.skipped")}: {result.skipped.length}
              </p>
            </div>
          ) : null}

          {issues.length > 0 ? (
            <div className="settings-section">
              <h4>{t("apply.sections.issues")}</h4>
              <div className="writeback-issues">
                {issues.slice(0, 60).map((issue, index) => (
                  <div key={`${issue.reason}-${issue.repoId || "global"}-${index}`} className="writeback-issue">
                    <span className="writeback-issue-reason">
                      {t(`apply.issueReasons.${issue.reason}`, { defaultValue: issue.reason })}
                    </span>
                    <span className="writeback-issue-msg">
                      {issue.repoFullName ? `${issue.repoFullName}: ` : ""}
                      {issue.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="helper-text">
              {t("common.labels.error")}: {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
