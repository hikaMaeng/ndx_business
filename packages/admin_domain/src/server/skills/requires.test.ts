import assert from "node:assert/strict";
import test from "node:test";
import { requiredCommands } from "./index.js";

const fence = (language: string, body: string): string => ["```" + language, body, "```"].join("\n");

test("a fence's language names the runtime the block needs", () => {
  // The important case, and the one a command scanner misses entirely: a page
  // of Python source contains no `python`, so a skill that only shows source
  // would read as needing nothing at all.
  assert.deepEqual(requiredCommands(fence("python", "import pypdf\nprint(1)\n")), ["python3"]);
  assert.deepEqual(requiredCommands(fence("js", "console.log(1)\n")), ["node"]);
  assert.deepEqual(requiredCommands(fence("ruby", "puts 1\n")), ["ruby"]);
});

test("a command line names its own command", () => {
  assert.deepEqual(requiredCommands(fence("bash", "npx create-thing\n")).sort(), ["bash", "npx"]);
  assert.deepEqual(requiredCommands(fence("bash", "soffice --headless --convert-to pdf x.docx\n")).sort(), ["bash", "soffice"]);
});

test("prose is not a dependency", () => {
  // `make`, `go` and `convert` are ordinary English words. A skill that says
  // "make sure to go through the references" is not asking for a build system,
  // and a list that claims otherwise is one nobody reads twice.
  const prose = [
    "# A skill",
    "",
    "Make sure to go through the references before you convert anything.",
    "The examples below will make it clear; go slowly.",
    "",
  ].join("\n");
  assert.deepEqual(requiredCommands(prose), []);
});

test("an argument is not a command", () => {
  // `scripts/convert.py` is a path, not ImageMagick. Only the first word of a
  // segment counts, which is what keeps a short list short.
  assert.deepEqual(requiredCommands(fence("bash", "python3 scripts/convert.py --magick off\n")).sort(), ["bash", "python3"]);
});

test("chained and prefixed commands are each seen", () => {
  const block = fence("bash", "$ cd out && python3 build.py | pandoc -o x.pdf\nAPI_KEY=secret node run.mjs\n");
  assert.deepEqual(requiredCommands(block).sort(), ["bash", "node", "pandoc", "python3"]);
});

test("indented blocks and inline spans count too", () => {
  // Not every SKILL.md uses fences; some indent by four spaces, and some name a
  // command inline. Both are how a person writes "run this".
  assert.deepEqual(requiredCommands("Run it:\n\n    node scripts/report.mjs\n"), ["node"]);
  assert.deepEqual(requiredCommands("Install with `uv sync` first.\n"), ["uv"]);
});

test("one name per runtime", () => {
  // A skill writing `python` and one writing `python3` are asking for the same
  // thing; reporting both makes a reader compare two entries to learn nothing.
  const both = fence("bash", "python x.py\npython3 y.py\n");
  assert.deepEqual(requiredCommands(both).sort(), ["bash", "python3"]);
  assert.deepEqual(requiredCommands(fence("bash", "pip install x\n")).sort(), ["bash", "pip3"]);
});

test("a skill that runs nothing asks for nothing", () => {
  // canvas-design is fonts and prose. An empty list is the right answer, and a
  // detector that always finds something is one that has stopped meaning it.
  assert.deepEqual(requiredCommands("# Fonts\n\nUse the fonts in `canvas-fonts/`.\n"), []);
  assert.deepEqual(requiredCommands(""), []);
});

test("an unclosed fence still reports what is in it", () => {
  // Truncated or malformed markdown is normal in files people edit by hand, and
  // losing the whole block would silently under-report.
  assert.deepEqual(requiredCommands("```bash\npandoc -o x.pdf y.md\n"), ["bash", "pandoc"]);
});
