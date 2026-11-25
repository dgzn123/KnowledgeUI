import { lstat, readFile, readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { Diagnostic, MarkdownBlockScanner, ProtocolReader } from "#contracts";

interface ValidateDependencies {
  readonly protocol: ProtocolReader;
  readonly scanner: MarkdownBlockScanner;
}

const usage = "Usage: validate [--] <file-or-directory> [...]";
const markdownExtensions = new Set([".md", ".markdown"]);

function fieldLabel(path: Diagnostic["path"]): string {
  return path.reduce<string>((label, field) => {
    if (typeof field === "number") return `${label}[${field}]`;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) return `${label}[${JSON.stringify(field)}]`;
    return label ? `${label}.${field}` : field;
  }, "") || "$";
}

export async function runValidate(args: readonly string[], { protocol, scanner }: ValidateDependencies): Promise<number> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log(usage);
    return 0;
  }
  const targets: string[] = [];
  let literal = false;
  for (const arg of args) {
    if (!literal && arg === "--") literal = true;
    else if (!literal && arg.startsWith("-")) {
      console.error(`Unknown option ${JSON.stringify(arg)}. ${usage}`);
      return 2;
    } else {
      targets.push(resolve(arg));
    }
  }
  if (!targets.length) {
    console.error(usage);
    return 2;
  }

  let validationFailed = false;
  let ioFailed = false;
  const files = new Set<string>();
  const directories = new Set<string>();

  function report(file: string, diagnostic: Diagnostic, blockStart = 1): void {
    const line = (diagnostic.range?.start.line ?? 1) + blockStart - 1;
    const column = diagnostic.range?.start.column ?? 1;
    console.error(`${file}:${line}:${column} ${diagnostic.severity} ${diagnostic.code} [${fieldLabel(diagnostic.path)}] ${diagnostic.message}`);
    if (diagnostic.severity === "error") validationFailed = true;
  }

  function reportIo(path: string, message: string): void {
    ioFailed = true;
    console.error(`${path}: error validate.io ${message}`);
  }

  async function validateFile(file: string): Promise<void> {
    if (files.has(file)) return;
    files.add(file);
    let markdown: string;
    try {
      markdown = await readFile(file, "utf8");
    } catch (error) {
      reportIo(file, error instanceof Error ? error.message : String(error));
      return;
    }
    const blocks = scanner.scan(markdown, file);
    for (const diagnostic of blocks.diagnostics) report(file, diagnostic);
    if (!blocks.ok) {
      validationFailed = true;
      return;
    }
    for (const block of blocks.value) {
      const result = protocol.read(block);
      for (const diagnostic of result.diagnostics) report(file, diagnostic, block.startLine);
      if (!result.ok) validationFailed = true;
    }
  }

  // Walk only supplied paths. Discovered symlinks never become traversal targets.
  for (const target of targets) {
    const pending = [{ path: target, explicit: true }];
    while (pending.length) {
      const { path, explicit } = pending.pop()!;
      try {
        const status = await lstat(path);
        if (status.isFile()) {
          await validateFile(path);
        } else if (status.isDirectory()) {
          if (directories.has(path)) continue;
          directories.add(path);
          const entries = await readdir(path, { withFileTypes: true });
          entries.sort((left, right) => left.name < right.name ? 1 : left.name > right.name ? -1 : 0);
          for (const entry of entries) {
            if (entry.isDirectory() || (entry.isFile() && markdownExtensions.has(extname(entry.name).toLowerCase()))) {
              pending.push({ path: join(path, entry.name), explicit: false });
            }
          }
        } else if (explicit) {
          reportIo(path, "Expected a regular file or directory. Symbolic links are not followed.");
        }
      } catch (error) {
        reportIo(path, error instanceof Error ? error.message : String(error));
      }
    }
  }
  return ioFailed ? 2 : validationFailed ? 1 : 0;
}
