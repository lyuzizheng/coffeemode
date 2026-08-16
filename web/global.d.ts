// Typed message keys for next-intl (issue #75): with AppConfig.Messages
// declared, t()/useTranslations()/getTranslations() reject keys that do not
// exist in the en catalog at typecheck time. `check:i18n` covers catalog
// drift; this covers code-side typos.
import en from "./messages/en.json";

declare module "next-intl" {
  interface AppConfig {
    Messages: typeof en;
  }
}
