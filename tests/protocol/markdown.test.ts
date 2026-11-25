import assert from "node:assert/strict";
import test from "node:test";
import { markdownBlockScanner } from "../../src/core/protocol/index.ts";
import { phase1Fixture, unwrap } from "./fixtures.ts";

test("scans matching backtick and tilde fences and skips other info strings", () => {
  const lines = [
    "Document",
    "````yaml",
    "```kui",
    "type: invalid",
    "```",
    "`````",
    "```kui extra",
    "type: ignored",
    "```",
    " ````kui",
    " version: 1",
    " type: text",
    " body: |",
    "   ```",
    " `````   ",
    "~~~kui",
    "type: divider",
    "~~~",
  ];
  const blocks = unwrap(markdownBlockScanner.scan(lines.join("\r\n"), "sample.md"));
  assert.deepEqual(blocks, [
    { yaml: "version: 1\r\ntype: text\r\nbody: |\r\n  ```\r\n", startLine: 11, endLine: 16, sourceId: "sample.md" },
    { yaml: "type: divider\r\n", startLine: 17, endLine: 19, sourceId: "sample.md" },
  ]);
});

test("dedents fences in list continuations, quotes, and mixed containers", () => {
  const lines = [
    "> - A list item",
    ">   ```kui",
    ">   type: text",
    ">   body: first",
    ">   ```",
    "",
    "1. ~~~kui",
    "   type: divider",
    "   ~~~~~",
    "",
    "- ",
    "  >   ```kui",
    "  >   type: divider",
    "  >   ```",
    "",
    ">\t~~~kui",
    ">\ttype: divider",
    ">\t~~~",
    "",
    "    ```kui",
    "    type: ignored",
    "    ```",
  ];
  const blocks = unwrap(markdownBlockScanner.scan(lines.join("\n")));
  assert.deepEqual(blocks, [
    { yaml: "type: text\nbody: first\n", startLine: 3, endLine: 6 },
    { yaml: "type: divider\n", startLine: 8, endLine: 10 },
    { yaml: "type: divider\n", startLine: 13, endLine: 15 },
    { yaml: "type: divider\n", startLine: 17, endLine: 19 },
  ]);
});

test("a container end closes its fence and preserves later independent blocks", () => {
  const blocks = unwrap(markdownBlockScanner.scan([
    "> ```kui",
    "> type: [",
    "",
    "```kui",
    "version: 1",
    "type: divider",
  ].join("\n")));
  assert.equal(blocks.length, 2);
  const protocol = phase1Fixture();
  assert.equal(protocol.read(blocks[0]!).ok, false);
  assert.equal(protocol.read(blocks[1]!).ok, true);
  assert.deepEqual(blocks.map(({ startLine, endLine }) => [startLine, endLine]), [[2, 3], [5, 7]]);
});

test("ignores HTML comment blocks at the root and inside nested containers", () => {
  const lines = [
    "```kui",
    "type: divider",
    "```",
    "  <!-- examples",
    "```kui",
    "type: ignored",
    "```",
    "",
    "-->",
    "> - <!--",
    ">   ~~~kui",
    ">   type: ignored",
    ">   ~~~",
    ">   -->",
    ">   ~~~kui",
    ">   type: divider",
    ">   ~~~",
    "<!-- one line -->",
    "~~~kui",
    "type: divider",
    "~~~",
  ];
  const blocks = unwrap(markdownBlockScanner.scan(lines.join("\n")));
  assert.deepEqual(blocks, [
    { yaml: "type: divider\n", startLine: 2, endLine: 4 },
    { yaml: "type: divider\n", startLine: 16, endLine: 18 },
    { yaml: "type: divider\n", startLine: 20, endLine: 22 },
  ]);
});

test("an unclosed HTML comment ends with its container or at EOF", () => {
  const lines = [
    "> - <!--",
    ">   ```kui",
    ">   type: ignored",
    "> ```kui",
    "> type: divider",
    "> ```",
    "<!--",
    "~~~kui",
    "type: ignored",
    "~~~",
  ];
  const blocks = unwrap(markdownBlockScanner.scan(lines.join("\n")));
  assert.deepEqual(blocks, [{ yaml: "type: divider\n", startLine: 5, endLine: 7 }]);
});

test("HTML comment markers within code fences are literal text", () => {
  const lines = [
    "````markdown",
    "<!-- this stays inside the outer fence",
    "```kui",
    "type: ignored",
    "```",
    "````",
    "~~~kui",
    "type: text",
    "body: |",
    "  <!-- example -->",
    "~~~",
  ];
  const blocks = unwrap(markdownBlockScanner.scan(lines.join("\n")));
  assert.deepEqual(blocks, [{
    yaml: "type: text\nbody: |\n  <!-- example -->\n", startLine: 8, endLine: 12,
  }]);
});

test("the first line outside a container may open a new outer fence", () => {
  const lines = [
    "> - ```kui",
    ">   type: divider",
    "> ```",
    "> text in code",
    "> ```",
    "After",
  ];
  const blocks = unwrap(markdownBlockScanner.scan(lines.join("\n")));
  assert.deepEqual(blocks, [{ yaml: "type: divider\n", startLine: 2, endLine: 3 }]);
});

test("empty fences and EOF use one-based exclusive source lines", () => {
  const cases = [
    ["```kui\n```", "", 2, 3],
    ["```kui\r\n```\r\n", "", 2, 3],
    ["> ```kui\nOutside", "", 2, 2],
    ["~~~kui", "", 2, 2],
    ["~~~kui\n", "", 2, 2],
    ["~~~kui\n\n", "\n", 2, 3],
    ["~~~kui\ntype: divider", "type: divider", 2, 3],
    ["~~~kui\ntype: divider\n", "type: divider\n", 2, 3],
  ] as const;
  for (const [markdown, yaml, startLine, endLine] of cases) {
    assert.deepEqual(unwrap(markdownBlockScanner.scan(markdown)), [{ yaml, startLine, endLine }], markdown);
  }
});
