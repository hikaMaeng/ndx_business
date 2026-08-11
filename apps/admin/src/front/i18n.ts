import ar from "../../assets/i18n/ar.json";
import en from "../../assets/i18n/en.json";
import es from "../../assets/i18n/es.json";
import fr from "../../assets/i18n/fr.json";
import hi from "../../assets/i18n/hi.json";
import ko from "../../assets/i18n/ko.json";
import pt from "../../assets/i18n/pt.json";
import zh from "../../assets/i18n/zh.json";

export type Texts = Record<string, string>;

// Every bundle carries the same key set; `check-i18n.sh` fails the build
// contract if they ever diverge.
const bundles: Record<string, Texts> = { ar, en, es, fr, hi, ko, pt, zh };
const fallbackLanguage = "en";

// Right-to-left scripts are part of the contract, not an afterthought. Keeping
// a real RTL locale in the shipped set is what stops layout from silently
// assuming one direction.
const rightToLeft = new Set(["ar", "fa", "he", "ur"]);

export function resolveLanguage(requested?: string): string {
  const stored = globalThis.localStorage?.getItem("admin.language") ?? undefined;
  const tag = (requested ?? stored ?? globalThis.navigator?.language ?? fallbackLanguage).slice(0, 2).toLowerCase();
  return tag in bundles ? tag : fallbackLanguage;
}

export function direction(language: string): "ltr" | "rtl" {
  return rightToLeft.has(language) ? "rtl" : "ltr";
}

export function texts(language: string = resolveLanguage()): Texts {
  return { ...bundles[fallbackLanguage], ...bundles[language] };
}
