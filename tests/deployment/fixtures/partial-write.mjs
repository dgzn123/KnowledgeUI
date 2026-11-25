import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";

const open = fs.open;
const target = join(process.env.KUI_TEST_PLUGIN_DIR, "styles.css");
let writes = 0;
fs.open = async (path, ...args) => {
  const file = await open(path, ...args);
  if (path === target && args[0] === "wx") {
    writes++;
    if (writes === 1 || process.env.KUI_TEST_INTERRUPTION === "persistent") {
      file.writeFile = async () => {
        await file.write("partial");
        if (process.env.KUI_TEST_INTERRUPTION === "kill") process.kill(process.pid, "SIGKILL");
        throw new Error("Injected partial write");
      };
    }
  }
  return file;
};
syncBuiltinESMExports();
