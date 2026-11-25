export type JsonScalar = null | boolean | number | string;
export type JsonValue = JsonScalar | JsonObject | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** Path segments are relative to the YAML root. Array indexes are zero-based. */
export type FieldPath = readonly (string | number)[];

export interface SourcePosition {
  /** One-based line and column. */
  readonly line: number;
  readonly column: number;
  /** Zero-based UTF-16 offset in the YAML block. */
  readonly offset: number;
}

export interface SourceRange {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface SourceLocation {
  readonly path: FieldPath;
  readonly range?: SourceRange;
}

export type DiagnosticPhase =
  | "yaml" | "schema" | "semantic" | "expression"
  | "state" | "render" | "extension" | "host";

export interface Diagnostic extends SourceLocation {
  /** Stable machine-readable code, prefixed by its domain (e.g. schema.required). */
  readonly code: string;
  readonly phase: DiagnosticPhase;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly sourceId?: string;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export interface Disposable {
  /** Idempotent. */
  dispose(): void;
}

export interface Lifetime extends Disposable {
  readonly signal: AbortSignal;
  add(cleanup: () => void): void;
  child(): Lifetime;
}

export const PROTOCOL_VERSION = 1;

export const V1_LIMITS = Object.freeze({
  sourceBytes: 128 * 1024,
  yamlDepth: 48,
  yamlNodes: 12_000,
  componentDepth: 24,
  componentInstances: 2_000,
  expressionLength: 1_024,
  expressionDepth: 32,
  expressionSteps: 2_048,
  repeatIterations: 200,
  svgElements: 1_000,
  chartSamplesPerSeries: 512,
  chartSamplesPerChart: 2_048,
  templateDepth: 12,
  diagnostics: 100,
});
