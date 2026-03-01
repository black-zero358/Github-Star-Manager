import { useState } from "react";
import { useTranslation } from "react-i18next";

type PatModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (token: string) => void;
};

export function PatModal({ isOpen, onClose, onSave }: PatModalProps) {
  const { t } = useTranslation();
  const [token, setToken] = useState("");

  if (!isOpen) return null;

  return (
    <div className="drawer" role="dialog" aria-modal="true">
      <div className="drawer-panel">
        <h3>{t("patModal.title")}</h3>
        <p>{t("patModal.description")}</p>
        <div className="input-row">
          <label htmlFor="pat-input">{t("patModal.tokenLabel")}</label>
          <input
            id="pat-input"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="ghp_..."
          />
        </div>
        <div className="drawer-actions">
          <button className="button" onClick={onClose}>
            {t("common.actions.cancel")}
          </button>
          <button
            className="button primary"
            onClick={() => {
              if (!token.trim()) return;
              onSave(token.trim());
              setToken("");
            }}
          >
            {t("patModal.savePat")}
          </button>
        </div>
      </div>
    </div>
  );
}
