import { bound, choice, component, identifier, label, list, object, string, tagged, text, union } from "./fields.ts";

const lineNumber = { type: "integer", minimum: 1 } as const;
const lineRange = object({ from: lineNumber, to: lineNumber }, ["from", "to"]);
const annotation = object({ line: lineNumber, text }, ["line", "text"]);
const terminalLine = object({
  kind: choice("command", "output", "error"), text, prompt: text,
}, ["kind", "text"]);
const fileEntry = { $ref: "#/$defs/FileEntry" };

export const fileEntrySchema = union(
  tagged("kind", "file", { name: label, detail: text }, ["name"]),
  tagged("kind", "directory", { name: label, children: list(fileEntry, 0, 128) }, ["name", "children"]),
);

export const technicalComponents = [
  component("code", "Read-only code with line annotations", {
    title: text, language: identifier, code: text,
    highlight: bound(list(union(lineNumber, lineRange), 0, 256)),
    annotations: list(annotation, 0, 256), lineNumbers: { type: "boolean" },
  }, ["code"]),
  component("terminal", "Read-only terminal transcript", {
    title: text, prompt: string, lines: list(terminalLine, 1, 512),
  }, ["lines"]),
  component("file-tree", "Expandable directory structure", {
    title: text, entries: list(fileEntry, 1, 128), openDepth: { type: "integer", minimum: 0, maximum: 16 },
  }, ["entries"]),
] as const;
