import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { runTwoStageClassification } from "../core/llmClassification";
import { db } from "../data/db";
import { useLiveQuery } from "../data/useLiveQuery";
import { normalizeAppLanguage, toPromptLanguage } from "../i18n/language";
import { useLlmConfigStore } from "../store/llmConfig";
import { usePreferenceStore } from "../store/preferences";

type LlmClassificationModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function LlmClassificationModal({ isOpen, onClose }: LlmClassificationModalProps) {
  const { t, i18n } = useTranslation();
  const { config } = useLlmConfigStore();
  const { preferences } = usePreferenceStore();
  const [stage, setStage] = useState("idle");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const [isTestMode, setIsTestMode] = useState(false);
  const [strictSingleTag, setStrictSingleTag] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState<"existing" | "run">("existing");

  const repos = useLiveQuery(
    async () => db.repos.toArray(),
    [],
    []
  );

  const classifications = useLiveQuery(async () => db.classifications.toArray(), [], []);
  const lists = useLiveQuery(async () => db.lists.toArray(), [], []);
  const repoLists = useLiveQuery(async () => db.repoLists.toArray(), [], []);

  const runs = useLiveQuery(
    async () => db.classificationRuns.orderBy("createdAt").reverse().toArray(),
    [],
    []
  );

  const selectedRunTags = useLiveQuery(
    async () => {
      if (!selectedRunId) return [];
      return db.classificationTags.where("runId").equals(selectedRunId).toArray();
    },
    [selectedRunId],
    []
  );

  const previewRows = useMemo(() => {
    const map = new Map(classifications.map((item) => [item.repoId, item.tags]));
    return repos.slice(0, 12).map((repo) => ({
      id: repo.id,
      name: repo.fullName,
      tags: map.get(repo.id) ?? [],
    }));
  }, [repos, classifications]);

  const existingListMap = useMemo(() => {
    const listMap = new Map(lists.map((list) => [list.id, list.name]));
    const out = new Map<string, string[]>();
    for (const row of repoLists) {
      const names = row.listIds.map((listId) => listMap.get(listId)).filter(Boolean) as string[];
      out.set(row.repoId, names);
    }
    return out;
  }, [lists, repoLists]);

  const diffRows = useMemo(() => {
    if (compareMode === "run" && !selectedRunId) return [];
    const runMap = new Map(selectedRunTags.map((item) => [item.repoId, item.tags]));
    const currentMap = new Map(classifications.map((item) => [item.repoId, item.tags]));
    const rows = repos.map((repo) => {
      const current = currentMap.get(repo.id) ?? [];
      const existing = existingListMap.get(repo.id) ?? [];
      const previous = compareMode === "run" ? runMap.get(repo.id) ?? [] : existing;
      const changed = previous.join("|") !== current.join("|");
      return {
        id: repo.id,
        name: repo.fullName,
        previous,
        current,
        existing,
        changed,
      };
    });
    return rows.filter((row) => row.changed).slice(0, 30);
  }, [repos, classifications, selectedRunTags, existingListMap, compareMode, selectedRunId]);

  if (!isOpen) return null;

  const handleRun = async () => {
    if (!config.apiKey || !config.baseUrl) {
      setError(t("classification.errors.missingConfig"));
      return;
    }
    if (repos.length === 0) {
      setError(t("classification.errors.noRepos"));
      return;
    }
    const repoBatch = isTestMode ? repos.slice(0, 5) : repos;
    const promptLanguage = toPromptLanguage(
      normalizeAppLanguage(i18n.resolvedLanguage || i18n.language)
    );
    setError("");
    setIsRunning(true);
    setStage("preparing");
    setProgress({ current: 0, total: repoBatch.length });
    try {
      const result = await runTwoStageClassification(
        config,
        repoBatch.map((repo) => ({
          id: repo.id,
          fullName: repo.fullName,
          description: repo.description,
          topics: repo.topics,
          language: repo.language,
          readmeExcerpt: repo.readmeExcerpt,
          existingLists: existingListMap.get(repo.id) ?? [],
        })),
        {
          strictSingleTag,
          pass1Prompt: config.pass1Prompt,
          pass1StrictPrompt: config.pass1StrictPrompt,
          pass2Prompt: config.pass2Prompt,
          useExistingLists: preferences.useExistingListsForClassification,
          allowNewTagsWithExistingLists: preferences.allowNewTagsWithExistingLists,
          language: promptLanguage,
        },
        (p) => {
          setStage(p.stage);
          setProgress({ current: p.current, total: p.total });
        }
      );

      await db.transaction(
        "rw",
        db.classifications,
        db.tagCompression,
        db.classificationRuns,
        db.classificationTags,
        async () => {
          await db.classifications.clear();
          await db.tagCompression.clear();
          const now = new Date().toISOString();
          const rows = Object.entries(result.repoTags).map(([repoId, tags]) => ({
            repoId,
            tags,
            lastRunAt: now,
          }));
          await db.classifications.bulkPut(rows);
          await db.tagCompression.bulkPut(
            Object.entries(result.tagMap).map(([tag, compressedTag]) => ({
              tag,
              compressedTag,
            }))
          );
          await db.classificationRuns.add({
            id: result.runId,
            createdAt: now,
            repoCount: repoBatch.length,
            strictSingleTag,
            testMode: isTestMode,
            pass1Prompt: config.pass1Prompt || "",
            pass1StrictPrompt: config.pass1StrictPrompt || "",
            pass2Prompt: config.pass2Prompt || "",
          });
          await db.classificationTags.bulkPut(
            Object.entries(result.repoTags).map(([repoId, tags]) => ({
              id: `${result.runId}:${repoId}`,
              runId: result.runId,
              repoId,
              tags,
            }))
          );
        }
      );
      setStage("completed");
      setSelectedRunId(result.runId);
    } catch (err) {
      setError((err as Error).message || t("classification.errors.classificationFailed"));
      setStage("failed");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="drawer" role="dialog" aria-modal="true">
      <div className="drawer-panel settings">
        <button className="panel-close" onClick={onClose} aria-label={t("classification.closeAria")}>
          ✕
        </button>
        <div className="settings-scroll">
          <h3>{t("classification.title")}</h3>
          <p>{t("classification.description")}</p>

          <div className="settings-section">
            <h4>{t("classification.sections.runStatus")}</h4>
            <p className="helper-text">
              {t("common.labels.stage")}: {t(`classification.stage.${stage}`, { defaultValue: stage })}
            </p>
            <p className="helper-text">
              {t("common.labels.progress")}: {progress.current}/{progress.total}
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={isTestMode}
                onChange={(event) => setIsTestMode(event.target.checked)}
              />
              {t("classification.toggles.testMode")}
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={strictSingleTag}
                onChange={(event) => setStrictSingleTag(event.target.checked)}
              />
              {t("classification.toggles.strictSingleTag")}
            </label>
            {error ? (
              <p className="helper-text">
                {t("common.labels.error")}: {error}
              </p>
            ) : null}
            <div className="settings-actions">
              <button className="button primary" onClick={handleRun} disabled={isRunning}>
                {isRunning ? t("classification.actions.running") : t("classification.actions.run")}
              </button>
            </div>
          </div>

          <div className="settings-section">
            <h4>{t("classification.sections.preview")}</h4>
            {previewRows.length === 0 ? (
              <p className="helper-text">{t("classification.status.noResults")}</p>
            ) : (
              <div className="preview-grid">
                {previewRows.map((row) => (
                  <div key={row.id} className="preview-card">
                    <div className="preview-title">{row.name}</div>
                    <div className="preview-tags">
                      {row.tags.length === 0
                        ? t("common.values.unclassified")
                        : row.tags.map((tag) => (
                            <span className="tag" key={tag}>
                              {tag}
                            </span>
                          ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="settings-section">
            <h4>{t("classification.sections.diffView")}</h4>
            <div className="input-row">
              <label htmlFor="diff-mode">{t("classification.labels.compareAgainst")}</label>
              <select
                id="diff-mode"
                value={compareMode}
                onChange={(event) => setCompareMode(event.target.value as "existing" | "run")}
              >
                <option value="existing">{t("classification.options.existingStarLists")}</option>
                <option value="run">{t("classification.options.previousRun")}</option>
              </select>
            </div>
            {compareMode === "run" ? (
              runs.length === 0 ? (
                <p className="helper-text">{t("classification.status.noSavedRuns")}</p>
              ) : (
                <div className="input-row">
                  <label htmlFor="run-select">{t("classification.labels.selectRun")}</label>
                  <select
                    id="run-select"
                    value={selectedRunId ?? ""}
                    onChange={(event) => setSelectedRunId(event.target.value || null)}
                  >
                    <option value="">{t("classification.options.selectRunPlaceholder")}</option>
                    {runs.map((run) => (
                      <option key={run.id} value={run.id}>
                        {new Date(run.createdAt).toLocaleString(i18n.language)} · {run.repoCount} {t("classification.options.reposSuffix")}
                        {run.testMode ? ` · ${t("classification.options.testSuffix")}` : ""}
                        {run.strictSingleTag ? ` · ${t("classification.options.singleSuffix")}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )
            ) : null}
            {compareMode === "run" && selectedRunId && diffRows.length === 0 ? (
              <p className="helper-text">{t("classification.status.noTagDiff")}</p>
            ) : null}
            {compareMode === "existing" && diffRows.length === 0 ? (
              <p className="helper-text">{t("classification.status.noDiffFromExisting")}</p>
            ) : null}
            {diffRows.length > 0 ? (
              <div className="diff-grid">
                {diffRows.map((row) => (
                  <div key={row.id} className="diff-card">
                    <div className="preview-title">{row.name}</div>
                    <div className="diff-row">
                      <span className="diff-label">{t("classification.labels.existing")}</span>
                      <span>{row.existing.join(", ") || t("common.values.none")}</span>
                    </div>
                    {compareMode === "run" ? (
                      <div className="diff-row">
                        <span className="diff-label">{t("classification.labels.previous")}</span>
                        <span>{row.previous.join(", ") || t("common.values.unclassified")}</span>
                      </div>
                    ) : null}
                    <div className="diff-row">
                      <span className="diff-label">{t("classification.labels.current")}</span>
                      <span>{row.current.join(", ") || t("common.values.unclassified")}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
