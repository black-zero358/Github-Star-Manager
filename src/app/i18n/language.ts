export type AppLanguage = "en" | "zh-CN";
export type UiLanguagePreference = "auto" | AppLanguage;
export type PromptLanguage = "en" | "zh";

export function normalizeAppLanguage(language?: string | null): AppLanguage {
  if (!language) return "en";
  return language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function detectBrowserLanguage(): AppLanguage {
  if (typeof navigator === "undefined") return "en";
  return normalizeAppLanguage(navigator.language);
}

export function resolveEffectiveLanguage(
  preference: UiLanguagePreference,
  browserLanguage: AppLanguage
): AppLanguage {
  return preference === "auto" ? browserLanguage : preference;
}

export function toPromptLanguage(language: AppLanguage): PromptLanguage {
  return language === "zh-CN" ? "zh" : "en";
}
