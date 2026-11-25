import type { ExtensionPackage } from "#contracts";
import { common } from "./common.ts";
import { electronics } from "./electronics.ts";

export const bundledExtensions: readonly ExtensionPackage[] = Object.freeze([common, electronics]);
