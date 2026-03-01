import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { setRepoListMembership } from "../core/repoListAssignments";
import { db } from "../data/db";
import { useLiveQuery } from "../data/useLiveQuery";

type AssignListModalProps = {
  isOpen: boolean;
  repoId: string;
  repoName: string;
  onClose: () => void;
};

export function AssignListModal({ isOpen, repoId, repoName, onClose }: AssignListModalProps) {
  const { t } = useTranslation();
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState("");

  const lists = useLiveQuery(
    async () => db.lists.orderBy("name").toArray(),
    [],
    []
  );

  const repoList = useLiveQuery(
    async () => db.repoLists.get(repoId),
    [repoId],
    undefined
  );

  useEffect(() => {
    if (!isOpen) return;
    setSelectedListIds(repoList?.listIds ?? []);
    setStatus("");
  }, [isOpen, repoId, repoList?.listIds]);

  const selectedSet = useMemo(() => new Set(selectedListIds), [selectedListIds]);

  if (!isOpen) return null;

  const toggleList = (listId: string) => {
    setSelectedListIds((prev) => {
      const has = prev.includes(listId);
      if (has) return prev.filter((id) => id !== listId);
      return [...prev, listId];
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    setStatus("");
    try {
      await setRepoListMembership(repoId, selectedListIds);
      setStatus(t("assignList.status.saved"));
    } catch (error) {
      setStatus((error as Error).message || t("assignList.status.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="drawer" role="dialog" aria-modal="true">
      <div className="drawer-panel settings">
        <button className="panel-close" onClick={onClose} aria-label={t("assignList.closeAria")}>
          ✕
        </button>
        <div className="settings-scroll">
          <h3>{t("assignList.title")}</h3>
          <p>{t("assignList.description", { repoName })}</p>
          <div className="settings-section">
            <h4>{t("assignList.sections.lists")}</h4>
            {lists.length === 0 ? (
              <p className="helper-text">{t("assignList.status.noLists")}</p>
            ) : (
              <div className="assign-list-grid">
                {lists.map((list) => (
                  <label className="assign-list-item" key={list.id}>
                    <input
                      type="checkbox"
                      checked={selectedSet.has(list.id)}
                      onChange={() => toggleList(list.id)}
                    />
                    <span>{list.name}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="settings-actions">
              <button className="button" onClick={() => setSelectedListIds([])} disabled={isSaving}>
                {t("common.actions.clear")}
              </button>
              <button className="button primary" onClick={handleSave} disabled={isSaving}>
                {isSaving ? t("assignList.status.saving") : t("common.actions.save")}
              </button>
            </div>
            {status ? <p className="helper-text">{status}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
