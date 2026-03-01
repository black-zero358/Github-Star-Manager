import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolvePrompts, type PromptFieldKey } from "../core/llmPromptResolver";
import { normalizeAppLanguage, toPromptLanguage, type UiLanguagePreference } from "../i18n/language";
import { requestCompletion } from "../services/llmClient";
import type { LLMConfig } from "../services/llmClient";
import { validatePat } from "../services/githubAuth";
import { useLlmConfigStore } from "../store/llmConfig";
import { usePreferenceStore } from "../store/preferences";

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

function getModeDescriptionKey(useExisting: boolean, allowNewTags: boolean): string {
  if (!useExisting) {
    return "settings.llm.modeBase";
  }
  if (allowNewTags) {
    return "settings.llm.modeExisting";
  }
  return "settings.llm.modeExistingOnly";
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { t, i18n } = useTranslation();
  const {
    preferences,
    setReadmeOptIn,
    setPatToken,
    setUseExistingListsForClassification,
    setAllowNewTagsWithExistingLists,
    setRefreshBeforeApply,
    setUiLanguage,
  } = usePreferenceStore();
  const { config, updateConfig, clearConfig } = useLlmConfigStore();
  const [patTokenInput, setPatTokenInput] = useState(preferences.patToken);
  const [patLoginInput, setPatLoginInput] = useState(preferences.viewerLogin);
  const [status, setStatus] = useState("");
  const [testStatus, setTestStatus] = useState("");
  const [isSavingPat, setIsSavingPat] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const promptLanguage = toPromptLanguage(normalizeAppLanguage(i18n.resolvedLanguage || i18n.language));

  const promptFieldMeta: Record<PromptFieldKey, { label: string; rows: number }> = useMemo(
    () => ({
      pass1Prompt: { label: t("settings.llm.promptLabels.pass1Prompt"), rows: 3 },
      pass1StrictPrompt: { label: t("settings.llm.promptLabels.pass1StrictPrompt"), rows: 2 },
      pass2Prompt: { label: t("settings.llm.promptLabels.pass2Prompt"), rows: 3 },
      pass1PromptWithExisting: {
        label: t("settings.llm.promptLabels.pass1PromptWithExisting"),
        rows: 3,
      },
      pass1PromptNoNewWithExisting: {
        label: t("settings.llm.promptLabels.pass1PromptNoNewWithExisting"),
        rows: 3,
      },
      pass1StrictPromptWithExisting: {
        label: t("settings.llm.promptLabels.pass1StrictPromptWithExisting"),
        rows: 2,
      },
      pass1StrictNoNewWithExisting: {
        label: t("settings.llm.promptLabels.pass1StrictNoNewWithExisting"),
        rows: 2,
      },
      pass2PromptWithExisting: {
        label: t("settings.llm.promptLabels.pass2PromptWithExisting"),
        rows: 3,
      },
      pass1PromptZh: { label: t("settings.llm.promptLabels.pass1PromptZh"), rows: 3 },
      pass1StrictPromptZh: {
        label: t("settings.llm.promptLabels.pass1StrictPromptZh"),
        rows: 2,
      },
      pass2PromptZh: { label: t("settings.llm.promptLabels.pass2PromptZh"), rows: 3 },
      pass1PromptWithExistingZh: {
        label: t("settings.llm.promptLabels.pass1PromptWithExistingZh"),
        rows: 3,
      },
      pass1PromptNoNewWithExistingZh: {
        label: t("settings.llm.promptLabels.pass1PromptNoNewWithExistingZh"),
        rows: 3,
      },
      pass1StrictPromptWithExistingZh: {
        label: t("settings.llm.promptLabels.pass1StrictPromptWithExistingZh"),
        rows: 2,
      },
      pass1StrictNoNewWithExistingZh: {
        label: t("settings.llm.promptLabels.pass1StrictNoNewWithExistingZh"),
        rows: 2,
      },
      pass2PromptWithExistingZh: {
        label: t("settings.llm.promptLabels.pass2PromptWithExistingZh"),
        rows: 3,
      },
    }),
    [t]
  );

  const resolvedPrompts = useMemo(
    () =>
      resolvePrompts(config, {
        strictSingleTag: false,
        useExistingLists: preferences.useExistingListsForClassification,
        allowNewTagsWithExistingLists: preferences.allowNewTagsWithExistingLists,
        language: promptLanguage,
      }),
    [
      config,
      preferences.useExistingListsForClassification,
      preferences.allowNewTagsWithExistingLists,
      promptLanguage,
    ]
  );

  const activePromptFields = useMemo(
    () => [
      {
        id: "llm-pass1-active",
        key: resolvedPrompts.activeKeys.pass1,
        label: t("settings.llm.activePass1"),
        rows: promptFieldMeta[resolvedPrompts.activeKeys.pass1].rows,
        value: resolvedPrompts.pass1,
      },
      {
        id: "llm-pass1-strict-active",
        key: resolvedPrompts.activeKeys.pass1Strict,
        label: t("settings.llm.activePass1Strict"),
        rows: promptFieldMeta[resolvedPrompts.activeKeys.pass1Strict].rows,
        value: resolvedPrompts.pass1Strict,
      },
      {
        id: "llm-pass2-active",
        key: resolvedPrompts.activeKeys.pass2,
        label: t("settings.llm.activePass2"),
        rows: promptFieldMeta[resolvedPrompts.activeKeys.pass2].rows,
        value: resolvedPrompts.pass2,
      },
    ],
    [resolvedPrompts, promptFieldMeta, t]
  );

  const inactivePromptFields = useMemo(
    () =>
      resolvedPrompts.inactiveKeys.map((key) => ({
        key,
        id: `llm-${key}`,
        label: promptFieldMeta[key].label,
        rows: promptFieldMeta[key].rows,
        value: config[key] || "",
      })),
    [config, promptFieldMeta, resolvedPrompts]
  );

  const modeDescription = useMemo(
    () =>
      t(
        getModeDescriptionKey(
          preferences.useExistingListsForClassification,
          preferences.allowNewTagsWithExistingLists
        )
      ),
    [
      preferences.useExistingListsForClassification,
      preferences.allowNewTagsWithExistingLists,
      t,
    ]
  );

  useEffect(() => {
    if (!isOpen) return;
    setPatTokenInput(preferences.patToken);
    setPatLoginInput(preferences.viewerLogin);
  }, [isOpen, preferences.patToken, preferences.viewerLogin]);

  if (!isOpen) return null;

  const handleTest = async () => {
    if (!config.baseUrl.trim()) {
      setTestStatus(t("settings.llm.missingBaseUrl"));
      return;
    }
    if (!config.apiKey.trim()) {
      setTestStatus(t("settings.llm.missingApiKey"));
      return;
    }
    setIsTesting(true);
    setTestStatus(t("settings.llm.testing"));
    const startedAt = performance.now();
    try {
      const response = await requestCompletion(
        config,
        [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Reply with OK" },
        ]
      );
      const elapsed = Math.round(performance.now() - startedAt);
      setTestStatus(t("settings.llm.testOk", { elapsed, response }));
    } catch (error) {
      const elapsed = Math.round(performance.now() - startedAt);
      const err = error as Error;
      const name = err?.name || "Error";
      const message = err?.message || "Test failed";
      setTestStatus(t("settings.llm.testError", { elapsed, name, message }));
    } finally {
      setIsTesting(false);
    }
  };

  const handleSavePat = async () => {
    const token = patTokenInput.trim();
    if (!token) {
      setStatus(t("settings.pat.required"));
      return;
    }
    setIsSavingPat(true);
    setStatus(t("settings.pat.validating"));
    try {
      const viewer = await validatePat(token);
      setPatToken(token, viewer.login);
      setPatLoginInput(viewer.login);
      setStatus(t("settings.pat.validated", { login: viewer.login }));
    } catch (error) {
      const err = error as Error;
      const name = err?.name || "Error";
      const message = err?.message || "Validation failed";
      setStatus(t("settings.pat.validationFailed", { name, message }));
    } finally {
      setIsSavingPat(false);
    }
  };

  const updatePromptField = (key: PromptFieldKey, value: string) => {
    updateConfig({ [key]: value } as Partial<LLMConfig>);
  };

  const promptLanguageLabel =
    promptLanguage === "zh"
      ? t("settings.language.promptLanguageChinese")
      : t("settings.language.promptLanguageEnglish");

  return (
    <div className="drawer" role="dialog" aria-modal="true">
      <div className="drawer-panel settings">
        <button className="panel-close" onClick={onClose} aria-label={t("settings.closeAria")}>
          ✕
        </button>
        <div className="settings-scroll">
          <h3>{t("settings.title")}</h3>
          <p>{t("settings.description")}</p>

          <div className="settings-section">
            <h4>{t("settings.sections.language")}</h4>
            <div className="input-row">
              <label htmlFor="ui-language-select">{t("settings.language.appLanguage")}</label>
              <select
                id="ui-language-select"
                value={preferences.uiLanguage}
                onChange={(event) => setUiLanguage(event.target.value as UiLanguagePreference)}
              >
                <option value="auto">{t("settings.language.auto")}</option>
                <option value="en">{t("settings.language.english")}</option>
                <option value="zh-CN">{t("settings.language.chineseSimplified")}</option>
              </select>
            </div>
          </div>

          <div className="settings-section">
            <h4>{t("settings.sections.patManagement")}</h4>
            <div className="input-row">
              <label htmlFor="pat-token">{t("settings.pat.githubPat")}</label>
              <input
                id="pat-token"
                type="password"
                value={patTokenInput}
                onChange={(event) => setPatTokenInput(event.target.value)}
                placeholder="ghp_..."
              />
            </div>
            <div className="input-row">
              <label htmlFor="pat-login">{t("settings.pat.githubLoginOptional")}</label>
              <input
                id="pat-login"
                type="text"
                value={patLoginInput}
                onChange={(event) => setPatLoginInput(event.target.value)}
                placeholder="octocat"
              />
            </div>
            <div className="settings-actions">
              <button className="button" onClick={handleSavePat} disabled={isSavingPat}>
                {isSavingPat ? t("settings.pat.validating") : t("settings.pat.savePat")}
              </button>
              <button
                className="button"
                onClick={() => {
                  setPatToken("", "");
                  setPatTokenInput("");
                  setPatLoginInput("");
                  setStatus(t("settings.pat.cleared"));
                }}
              >
                {t("settings.pat.clearPat")}
              </button>
            </div>
          </div>

          <div className="settings-section">
            <h4>{t("settings.sections.llmConfiguration")}</h4>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={preferences.useExistingListsForClassification}
                onChange={(event) =>
                  setUseExistingListsForClassification(event.target.checked)
                }
              />
              {t("settings.llm.useExistingLists")}
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={preferences.allowNewTagsWithExistingLists}
                onChange={(event) =>
                  setAllowNewTagsWithExistingLists(event.target.checked)
                }
                disabled={!preferences.useExistingListsForClassification}
              />
              {t("settings.llm.allowNewTags")}
            </label>
            <p className="helper-text">
              {t("settings.language.promptLanguage", { language: promptLanguageLabel })}
            </p>
            <div className="prompt-mode-card">
              <p className="prompt-mode-title">{t("settings.llm.currentMode")}</p>
              <p className="prompt-mode-value">{modeDescription}</p>
            </div>
            <div className="input-row">
              <label htmlFor="llm-base">{t("settings.llm.baseUrl")}</label>
              <input
                id="llm-base"
                type="text"
                value={config.baseUrl}
                onChange={(event) => updateConfig({ baseUrl: event.target.value })}
              />
            </div>
            <div className="input-row">
              <label htmlFor="llm-key">{t("settings.llm.apiKey")}</label>
              <input
                id="llm-key"
                type="password"
                value={config.apiKey}
                onChange={(event) => updateConfig({ apiKey: event.target.value })}
              />
            </div>
            <div className="input-row">
              <label htmlFor="llm-model">{t("settings.llm.model")}</label>
              <input
                id="llm-model"
                type="text"
                value={config.model}
                onChange={(event) => updateConfig({ model: event.target.value })}
              />
            </div>
            <div className="input-row inline">
              <div>
                <label htmlFor="llm-temp">{t("settings.llm.temperature")}</label>
                <input
                  id="llm-temp"
                  type="number"
                  step="0.1"
                  value={config.temperature}
                  onChange={(event) => updateConfig({ temperature: Number(event.target.value) })}
                />
              </div>
              <div>
                <label htmlFor="llm-max">{t("settings.llm.maxTokens")}</label>
                <input
                  id="llm-max"
                  type="number"
                  step="1"
                  value={config.maxTokens}
                  onChange={(event) => updateConfig({ maxTokens: Number(event.target.value) })}
                />
              </div>
            </div>
            {activePromptFields.map((field) => (
              <div className="input-row" key={field.id}>
                <label htmlFor={field.id}>{field.label}</label>
                <textarea
                  id={field.id}
                  rows={field.rows}
                  value={field.value}
                  onChange={(event) => updatePromptField(field.key, event.target.value)}
                />
              </div>
            ))}
            <details className="advanced-prompts">
              <summary>{t("settings.llm.advancedSettings", { count: inactivePromptFields.length })}</summary>
              <p className="helper-text">{t("settings.llm.advancedHelp")}</p>
              {inactivePromptFields.map((field) => (
                <div className="input-row" key={field.id}>
                  <label htmlFor={field.id}>{field.label}</label>
                  <textarea
                    id={field.id}
                    rows={field.rows}
                    value={field.value}
                    onChange={(event) => updatePromptField(field.key, event.target.value)}
                  />
                </div>
              ))}
            </details>
            <div className="settings-actions">
              <button className="button" onClick={handleTest} disabled={isTesting}>
                {isTesting ? t("settings.llm.testing") : t("settings.llm.testLlm")}
              </button>
              <button
                className="button"
                onClick={() => {
                  clearConfig();
                  setTestStatus(t("settings.llm.cleared"));
                }}
              >
                {t("settings.llm.resetLlm")}
              </button>
            </div>
            {testStatus ? <p className="helper-text">{testStatus}</p> : null}
          </div>

          <div className="settings-section">
            <h4>{t("settings.sections.readmeFetching")}</h4>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={preferences.readmeOptIn}
                onChange={(event) => setReadmeOptIn(event.target.checked)}
              />
              {t("settings.readme.enable")}
            </label>
          </div>

          <div className="settings-section">
            <h4>{t("settings.sections.writeback")}</h4>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={preferences.refreshBeforeApply}
                onChange={(event) => setRefreshBeforeApply(event.target.checked)}
              />
              {t("settings.writeback.refreshBeforeApply")}
            </label>
            <p className="helper-text">{t("settings.writeback.refreshHelp")}</p>
          </div>

          <div className="settings-section">
            <h4>{t("settings.sections.localCache")}</h4>
            <p className="helper-text">{t("settings.cache.help")}</p>
            <button
              className="button"
              onClick={() => {
                indexedDB.deleteDatabase("star-manager");
                setStatus(t("settings.cache.cleared"));
                setTimeout(() => window.location.reload(), 300);
              }}
            >
              {t("settings.cache.clearButton")}
            </button>
          </div>

          {status ? <p className="helper-text">{status}</p> : null}
        </div>
      </div>
    </div>
  );
}
