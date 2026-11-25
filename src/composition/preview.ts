import { mountPreview } from "../../preview/index.ts";
import { markdownBlockScanner } from "../core/protocol/index.ts";
import { createActiveRenderer } from "./runtime.ts";
import { componentSamples, previewDocuments } from "./preview-notes.ts";

const container = document.querySelector<HTMLElement>("#kui-preview");
if (!container) throw new Error("Preview mount point is missing.");
const sources = [...previewDocuments, componentSamples].map(({ label, output }) => ({ label, path: "./" + output }));
mountPreview(container, createActiveRenderer, markdownBlockScanner, sources);
