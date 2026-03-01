import { useTranslation } from "react-i18next";

type FirstRunPromptProps = {
  onConfirm: (enableReadme: boolean) => void;
  onSkip: () => void;
};

export function FirstRunPrompt({ onConfirm, onSkip }: FirstRunPromptProps) {
  const { t } = useTranslation();

  return (
    <div className="drawer" role="dialog" aria-modal="true">
      <div className="drawer-panel">
        <h3>{t("onboarding.title")}</h3>
        <p>{t("onboarding.description1")}</p>
        <p>{t("onboarding.description2")}</p>
        <div className="drawer-actions">
          <button className="button" onClick={onSkip}>
            {t("onboarding.skip")}
          </button>
          <button className="button primary" onClick={() => onConfirm(true)}>
            {t("onboarding.enable")}
          </button>
        </div>
      </div>
    </div>
  );
}
