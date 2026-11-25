import { createKnowledgeUiPlugin } from "../main.ts";
import { createActiveRenderer } from "./runtime.ts";

export default createKnowledgeUiPlugin(createActiveRenderer);
