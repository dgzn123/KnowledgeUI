import { buildObsidian, buildPreview, watchProduct } from "./bundles.mjs";

if (process.argv[2] === "--watch") {
  await watchProduct();
} else {
  await buildObsidian();
  await buildPreview();
}
