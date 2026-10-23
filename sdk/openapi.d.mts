import type { BindingKind, Value } from './index.mjs';

export interface OpenApiDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  /** JSON Pointer into the OpenAPI document. */
  path: string;
}
export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  /** Value shape implied by the schema type, when unambiguous. */
  shape: BindingKind | null;
  /** RFC 6570 variable name (percent-encoded when needed); null for header, cookie and unsupported parameters. */
  variable: string | null;
}
export interface OpenApiOperation {
  id: string | null;
  method: string;
  path: string;
  /** Path and query as one RFC 6570 template, or null when a path parameter cannot be expressed. */
  template: string | null;
  parameters: readonly OpenApiParameter[];
  unsupported: readonly { name: string; in: string; reason: string }[];
  /** The template expanded with the document's own examples, when every path parameter has one. */
  example: string | null;
}
export interface OpenApiAnalysis {
  schemaVersion: 2;
  /** No error-level diagnostics. Warnings do not affect ok. */
  ok: boolean;
  complete: boolean;
  operations: OpenApiOperation[];
  diagnostics: OpenApiDiagnostic[];
  truncated: { errors: number; warnings: number };
}
export function templateName(name: string): string;
export function analyzeOpenApi(document: unknown): OpenApiAnalysis;

export interface CompileOpenApiOptions {
  /** Prepended to every expansion; trailing slashes are removed. */
  baseUrl?: string;
  /** Throw OpenApiInvalid when any error-level diagnostic exists. Default false. */
  strict?: boolean;
}
export declare class OpenApiTemplates {
  private constructor();
  readonly operations: readonly OpenApiOperation[];
  readonly diagnostics: readonly OpenApiDiagnostic[];
  /** By operationId or "METHOD /path". */
  get(operation: string): OpenApiOperation;
  /** Header and cookie parameters are accepted and left out of the URI. */
  expand(operation: string, variables?: Readonly<Record<string, Value>>): string;
}
export function compileOpenApi(document: string | object, options?: CompileOpenApiOptions): OpenApiTemplates;
