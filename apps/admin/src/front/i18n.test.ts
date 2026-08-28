import assert from "node:assert/strict";
import test from "node:test";
import { installDom } from "./testing/dom.js";

installDom();

const { texts } = await import("./i18n.js");
const { RSC } = await import("./resource.js");

const LANGUAGES = ["ar", "en", "es", "fr", "hi", "ko", "pt", "zh"] as const;

/**
 * The bundles have to agree, and a comment saying so is not a contract.
 *
 * `i18n.ts` claimed a `check-i18n.sh` enforced this. No such script is in the
 * repository, so nothing did — a key added to one bundle and forgotten in seven
 * would ship as a blank label in those languages, which reads as a layout bug
 * rather than a missing translation.
 */
test("every language carries the same keys", () => {
  const reference = Object.keys(texts("en")).sort();
  for (const language of LANGUAGES) {
    const keys = Object.keys(texts(language)).sort();
    const missing = reference.filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !reference.includes(key));
    assert.deepEqual(
      { missing, extra }, { missing: [], extra: [] },
      `${language}.json does not match en.json`,
    );
  }
});

test("every key the code asks for exists, in every language", () => {
  const used = Object.values(RSC) as string[];
  for (const language of LANGUAGES) {
    const bundle = texts(language);
    const absent = used.filter((key) => typeof bundle[key] !== "string" || bundle[key] === "");
    assert.deepEqual(absent, [], `${language}.json has no usable text for these keys the app renders`);
  }
});
