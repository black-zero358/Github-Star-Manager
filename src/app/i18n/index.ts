import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { detectBrowserLanguage } from "./language";
import { resources } from "./resources";

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: detectBrowserLanguage(),
    fallbackLng: "en",
    supportedLngs: ["en", "zh-CN"],
    interpolation: {
      escapeValue: false,
    },
  });
}

export { i18n };
