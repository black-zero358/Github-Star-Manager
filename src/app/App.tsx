import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { detectBrowserLanguage, resolveEffectiveLanguage } from "./i18n/language";
import { retryListMembership, syncFromGitHub } from "./core/githubSync";
import { db } from "./data/db";
import { useLiveQuery } from "./data/useLiveQuery";
import { validatePat } from "./services/githubAuth";
import { usePreferenceStore } from "./store/preferences";
import { ApplyUpdatesModal } from "./ui/ApplyUpdatesModal";
import { AssignListModal } from "./ui/AssignListModal";
import { FirstRunPrompt } from "./ui/FirstRunPrompt";
import { LlmClassificationModal } from "./ui/LlmClassificationModal";
import { PatModal } from "./ui/PatModal";
import { SettingsModal } from "./ui/SettingsModal";

type RepoPreview = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  language?: string | null;
  stars?: number;
  updatedAt?: string;
};

type SyncStatusCode = "idle" | "running" | "completed" | "failed" | "ready" | "retrying";

type SyncMessage = {
  key: string;
  values?: Record<string, number | string>;
};

const previewRepos: RepoPreview[] = [];
const previewLists: { id: string; name: string; count: number }[] = [
  { id: "all", name: "", count: 0 },
];

export default function App() {
  const { t, i18n } = useTranslation();
  const { preferences, setReadmeOptIn, markOnboarded, setPatToken, setLastSyncedAt } =
    usePreferenceStore();
  const [activeList, setActiveList] = useState("all");
  const [isPatModalOpen, setIsPatModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isClassificationOpen, setIsClassificationOpen] = useState(false);
  const [isApplyUpdatesOpen, setIsApplyUpdatesOpen] = useState(false);
  const [assignRepo, setAssignRepo] = useState<{ id: string; name: string } | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatusCode>("idle");
  const [syncMessage, setSyncMessage] = useState<SyncMessage>({
    key: "app.sync.detail.connectPat",
  });
  const [syncError, setSyncError] = useState("");
  const [syncStage, setSyncStage] = useState("idle");
  const [syncCurrent, setSyncCurrent] = useState(0);
  const [syncTotal, setSyncTotal] = useState(0);
  const [syncFailed, setSyncFailed] = useState(0);
  const [failedListIds, setFailedListIds] = useState<string[]>([]);
  const [languageFilter, setLanguageFilter] = useState("all");
  const [showUnlisted, setShowUnlisted] = useState(false);
  const [recentOnly, setRecentOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const browserLanguage = useMemo(() => detectBrowserLanguage(), []);
  const effectiveLanguage = useMemo(
    () => resolveEffectiveLanguage(preferences.uiLanguage, browserLanguage),
    [preferences.uiLanguage, browserLanguage]
  );

  useEffect(() => {
    void i18n.changeLanguage(effectiveLanguage);
    document.documentElement.lang = effectiveLanguage;
  }, [i18n, effectiveLanguage]);

  useEffect(() => {
    if (!preferences.hasCompletedOnboarding) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
    return undefined;
  }, [preferences.hasCompletedOnboarding]);

  const lists = useLiveQuery(
    async () => {
      const listRows = await db.lists.toArray();
      const repoListRows = await db.repoLists.toArray();
      const countMap = new Map<string, number>();
      for (const row of repoListRows) {
        for (const listId of row.listIds) {
          countMap.set(listId, (countMap.get(listId) ?? 0) + 1);
        }
      }

      const listCounts = listRows.map((list) => ({
        id: list.id,
        name: list.name,
        count: countMap.get(list.id) ?? 0,
      }));
      const total = await db.repos.count();
      return [{ id: "all", name: "", count: total }, ...listCounts];
    },
    [],
    previewLists
  );

  const repos = useLiveQuery(
    async () => {
      const repoRows = await db.repos.toArray();
      const listMap = new Map<string, string>();
      const listRows = await db.lists.toArray();
      for (const list of listRows) listMap.set(list.id, list.name);

      const repoListRows = await db.repoLists.toArray();
      const repoListLookup = new Map(repoListRows.map((row) => [row.repoId, row.listIds]));

      return repoRows.map((repo) => ({
        id: repo.id,
        name: repo.fullName,
        description: repo.description || "",
        tags: (repoListLookup.get(repo.id) || [])
          .map((listId) => listMap.get(listId))
          .filter((name): name is string => Boolean(name))
          .slice(0, 4),
        language: repo.language,
        stars: repo.stargazerCount,
        updatedAt: repo.updatedAt,
      }));
    },
    [],
    previewRepos
  );

  const languageOptions = useMemo(() => {
    const set = new Set<string>();
    for (const repo of repos) {
      if (repo.language) set.add(repo.language);
    }
    return ["all", ...Array.from(set).sort()];
  }, [repos]);

  const visibleRepos = useMemo(() => {
    if (activeList === "all") return repos;
    const listName = lists.find((list) => list.id === activeList)?.name;
    if (!listName) return [];
    return repos.filter((repo) => repo.tags.includes(listName));
  }, [activeList, repos, lists]);

  const filteredRepos = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const threshold = Date.now() - 1000 * 60 * 60 * 24 * 180;
    return visibleRepos.filter((repo) => {
      if (query) {
        const haystack = `${repo.name} ${repo.description}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (languageFilter !== "all" && repo.language !== languageFilter) return false;
      if (showUnlisted && repo.tags.length > 0) return false;
      if (recentOnly && repo.updatedAt) {
        const updatedAt = Date.parse(repo.updatedAt);
        if (!Number.isNaN(updatedAt) && updatedAt < threshold) return false;
      }
      return true;
    });
  }, [visibleRepos, languageFilter, showUnlisted, recentOnly, searchQuery]);

  const lastSyncText = useMemo(() => {
    if (!preferences.lastSyncedAt) return "";
    const parsed = Date.parse(preferences.lastSyncedAt);
    if (Number.isNaN(parsed)) return preferences.lastSyncedAt;
    return new Date(parsed).toLocaleString(i18n.language);
  }, [preferences.lastSyncedAt, i18n.language]);

  const syncDetail = useMemo(() => {
    if (syncError) return syncError;
    if (syncStatus === "running" || syncStatus === "retrying") {
      const stageText = t(`progress.sync.${syncStage}`, { defaultValue: syncStage });
      return t("app.sync.detail.progress", {
        stage: stageText,
        current: syncCurrent,
        total: syncTotal,
      });
    }
    return t(syncMessage.key, syncMessage.values);
  }, [syncError, syncStatus, syncStage, syncCurrent, syncTotal, syncMessage, t]);

  useEffect(() => {
    if (activeList === "all") return;
    const exists = lists.some((list) => list.id === activeList);
    if (!exists) setActiveList("all");
  }, [activeList, lists]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">★</div>
          <div>
            <h1 className="brand-title">{t("common.appName")}</h1>
            <p className="brand-subtitle">{t("app.subtitle")}</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="button" onClick={() => setIsPatModalOpen(true)}>
            {preferences.viewerLogin
              ? `PAT: ${preferences.viewerLogin}`
              : t("app.actions.connectPat")}
          </button>
          <button className="button" onClick={() => setIsSettingsOpen(true)}>
            {t("common.actions.settings")}
          </button>
          <button
            className="button primary"
            onClick={async () => {
              if (!preferences.patToken) {
                setIsPatModalOpen(true);
                return;
              }
              setSyncStatus("running");
              setSyncError("");
              setSyncMessage({ key: "app.sync.detail.preparing" });
              setSyncStage("idle");
              setSyncCurrent(0);
              setSyncTotal(0);
              setSyncFailed(0);
              try {
                const result = await syncFromGitHub({ token: preferences.patToken }, (progress) => {
                  setSyncStage(progress.stage);
                  setSyncCurrent(progress.current);
                  setSyncTotal(progress.total);
                  setSyncFailed(progress.failed);
                });
                setSyncStatus("completed");
                setSyncMessage({
                  key: "app.sync.detail.loaded",
                  values: { repos: result.repos, lists: result.lists },
                });
                setFailedListIds(result.failedListIds);
                setLastSyncedAt(new Date().toISOString());
                if (result.failedListIds.length === 0) {
                  setSyncFailed(0);
                }
              } catch (error) {
                setSyncStatus("failed");
                setSyncError((error as Error).message || t("app.sync.detail.syncFailed"));
              }
            }}
          >
            {t("app.actions.syncStarLists")}
          </button>
        </div>
      </header>

      <main className="app-main">
        <section className="panel">
          <h2>{t("app.sections.starLists")}</h2>
          {lists.length === 1 && lists[0].id === "all" ? (
            <div className="empty-state">
              <p>{t("app.empty.noListsTitle")}</p>
              <p>{t("app.empty.noListsHint")}</p>
            </div>
          ) : (
            lists.map((list) => (
              <div
                key={list.id}
                className={`list-item ${activeList === list.id ? "active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => setActiveList(list.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") setActiveList(list.id);
                }}
              >
                <span>{list.id === "all" ? t("common.values.allStarred") : list.name}</span>
                <span>{list.count}</span>
              </div>
            ))
          )}
        </section>

        <section className="panel">
          <h2>{t("app.sections.repositories")}</h2>
          {repos.length === 0 ? (
            <div className="empty-state">
              <p>{t("app.empty.noDataTitle")}</p>
              <p>{t("app.empty.noDataHint")}</p>
            </div>
          ) : (
            <div className="filters">
              <div className="filter-group">
                <label htmlFor="language-select">{t("common.labels.language")}</label>
                <select
                  id="language-select"
                  value={languageFilter}
                  onChange={(event) => setLanguageFilter(event.target.value)}
                >
                  {languageOptions.map((option) => (
                    <option key={option} value={option}>
                      {option === "all" ? t("common.values.all") : option}
                    </option>
                  ))}
                </select>
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={showUnlisted}
                  onChange={(event) => setShowUnlisted(event.target.checked)}
                />
                {t("app.filters.noList")}
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={recentOnly}
                  onChange={(event) => setRecentOnly(event.target.checked)}
                />
                {t("app.filters.updatedLastSixMonths")}
              </label>
              <div className="filter-group search">
                <label htmlFor="repo-search">{t("common.labels.search")}</label>
                <input
                  id="repo-search"
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t("app.filters.searchPlaceholder")}
                />
              </div>
            </div>
          )}
          {repos.length > 0 && filteredRepos.length === 0 ? (
            <div className="empty-state">
              <p>{t("app.empty.noFilteredTitle")}</p>
              <p>{t("app.empty.noFilteredHint")}</p>
            </div>
          ) : repos.length === 0 ? null : (
            <div className="repo-grid">
              {filteredRepos.map((repo) => (
                <article key={repo.id} className="repo-card">
                  <h3 className="repo-title">{repo.name}</h3>
                  <p className="repo-desc">{repo.description || t("app.values.noDescription")}</p>
                  <div>
                    {repo.tags.map((tag) => (
                      <span className="tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="repo-meta">
                    <span>{repo.language || t("common.labels.unknown")}</span>
                    <span>★ {repo.stars ?? 0}</span>
                  </div>
                  <button
                    className="button"
                    onClick={() => setAssignRepo({ id: repo.id, name: repo.name })}
                  >
                    {t("app.actions.assignList")}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="sidebar-meta">
          <div className="meta-card">
            <h3 className="meta-title">{t("app.sections.syncStatus")}</h3>
            <p className="meta-desc">
              {t("common.labels.status")}: {t(`app.sync.status.${syncStatus}`, { defaultValue: syncStatus })}
            </p>
            <p className="meta-desc">{syncDetail}</p>
            <p className="meta-desc">
              {t("common.labels.stage")}: {t(`progress.sync.${syncStage}`, { defaultValue: syncStage })}
            </p>
            <p className="meta-desc">
              {t("common.labels.progress")}: {syncCurrent}/{syncTotal} · {t("common.labels.failed")}: {syncFailed}
            </p>
            {preferences.lastSyncedAt ? (
              <p className="meta-desc">
                {t("common.labels.lastSync")}: {lastSyncText}
              </p>
            ) : null}
            {failedListIds.length > 0 ? (
              <button
                className="button"
                onClick={async () => {
                  if (!preferences.patToken) return;
                  setSyncStatus("retrying");
                  setSyncError("");
                  try {
                    const result = await retryListMembership(
                      { token: preferences.patToken },
                      failedListIds,
                      (progress) => {
                        setSyncStage(progress.stage);
                        setSyncCurrent(progress.current);
                        setSyncTotal(progress.total);
                        setSyncFailed(progress.failed);
                      }
                    );
                    setFailedListIds(result.failedListIds);
                    setSyncStatus("completed");
                    setSyncMessage({
                      key:
                        result.failedListIds.length === 0
                          ? "app.sync.detail.retryRecovered"
                          : "app.sync.detail.retryFinished",
                      values:
                        result.failedListIds.length === 0
                          ? undefined
                          : { count: result.failedListIds.length },
                    });
                  } catch (error) {
                    setSyncStatus("failed");
                    setSyncError((error as Error).message || t("app.sync.detail.retryFailed"));
                  }
                }}
              >
                {t("app.actions.retryFailedLists", { count: failedListIds.length })}
              </button>
            ) : null}
          </div>
          <div className="meta-card">
            <h3 className="meta-title">{t("app.sections.llmClassification")}</h3>
            <p className="meta-desc">{t("app.sidebar.llmDesc")}</p>
            <button className="button" onClick={() => setIsSettingsOpen(true)}>
              {t("app.actions.configureLlm")}
            </button>
            <button className="button" onClick={() => setIsClassificationOpen(true)}>
              {t("app.actions.runClassification")}
            </button>
          </div>
          <div className="meta-card">
            <h3 className="meta-title">{t("app.sections.batchActions")}</h3>
            <p className="meta-desc">{t("app.sidebar.batchDesc")}</p>
            <button className="button primary" onClick={() => setIsApplyUpdatesOpen(true)}>
              {t("app.actions.applyUpdates")}
            </button>
          </div>
        </section>
      </main>

      {!preferences.hasCompletedOnboarding ? (
        <FirstRunPrompt
          onConfirm={(value) => {
            setReadmeOptIn(value);
            markOnboarded();
          }}
          onSkip={() => {
            setReadmeOptIn(false);
            markOnboarded();
          }}
        />
      ) : null}
      <PatModal
        isOpen={isPatModalOpen}
        onClose={() => setIsPatModalOpen(false)}
        onSave={async (token) => {
          try {
            const viewer = await validatePat(token);
            setPatToken(token, viewer.login);
            setSyncStatus("ready");
            setSyncError("");
            setSyncMessage({ key: "app.sync.detail.tokenOk", values: { login: viewer.login } });
            setIsPatModalOpen(false);
          } catch (error) {
            setSyncStatus("failed");
            setSyncError((error as Error).message || t("app.sync.detail.tokenValidationFailed"));
          }
        }}
      />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <LlmClassificationModal
        isOpen={isClassificationOpen}
        onClose={() => setIsClassificationOpen(false)}
      />
      <ApplyUpdatesModal
        isOpen={isApplyUpdatesOpen}
        onClose={() => setIsApplyUpdatesOpen(false)}
        token={preferences.patToken}
        onRequestToken={() => setIsPatModalOpen(true)}
      />
      {assignRepo ? (
        <AssignListModal
          isOpen={Boolean(assignRepo)}
          repoId={assignRepo.id}
          repoName={assignRepo.name}
          onClose={() => setAssignRepo(null)}
        />
      ) : null}
    </div>
  );
}
