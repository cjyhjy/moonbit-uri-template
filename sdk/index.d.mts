export type Value = string | readonly string[] | Readonly<Record<string, string | null>> | null;
export type Operator = '+' | '#' | '.' | '/' | ';' | '?' | '&';
type StripOperator<S extends string> = S extends `${Operator}${infer Rest}` ? Rest : S;
type StripModifier<S extends string> = S extends `${infer Name}:${string}` ? Name : S extends `${infer Name}*` ? Name : S;
type Names<S extends string> = S extends `${infer First},${infer Rest}` ? StripModifier<First> | Names<Rest> : StripModifier<S>;
export type TemplateVariables<S extends string> = string extends S ? string :
  S extends `${string}{${infer Expression}}${infer Rest}` ? Names<StripOperator<Expression>> | TemplateVariables<Rest> : never;
export type Bindings<N extends string, R extends N = never> =
  Partial<Record<N, Value>> & Record<R, Exclude<Value, null>>;
export interface Limits {
  maxTemplate?: number;
  maxExpressions?: number;
  maxVarsPerExpression?: number;
  maxVariables?: number;
  maxBindings?: number;
  maxMembers?: number;
  maxValue?: number;
  maxTotalValue?: number;
  maxOutput?: number;
  maxJson?: number;
  maxJsonDepth?: number;
}
export interface CompileOptions<N extends string = string, R extends N = never> extends Limits {
  strict?: boolean;
  rejectUnused?: boolean;
  required?: readonly R[];
  /** All-reference requirements are also enforced at runtime. */
  requireAll?: boolean;
}
export interface BatchLimits {
  maxItems?: number;
  /** Includes serialized JSON punctuation, unlike MoonBit's typed batch API. */
  maxTotalInputCodepoints?: number;
  maxTotalOutputBytes?: number;
}
export interface BindingIssue { name: string; start: number; end: number; }
export interface Diagnostic {
  code: string; message: string; path?: string;
  start?: number; end?: number; line?: number; column?: number;
  utf16Start?: number; utf16End?: number; index?: number;
}
export interface BindingReport {
  referenced: string[]; missing: BindingIssue[]; omitted: BindingIssue[];
  unused: string[]; invalid: Array<{ code: string; start: number; end: number }>;
  offsetUnit: 'unicode-code-point';
}
export interface Trace {
  uri: string; bytes: number;
  origins: Array<{ name: string | null; start: number; end: number; outputStart: number; outputEnd: number }>;
}
export class UriTemplateError extends Error implements Diagnostic {
  code: string; path?: string; start?: number; end?: number;
  line?: number; column?: number; utf16Start?: number; utf16End?: number; index?: number;
  constructor(detail: Diagnostic, source?: string);
}
export type ExpansionResult = { ok: true; value: string } | { ok: false; error: UriTemplateError };
export interface Span { start: number; end: number; }
export interface VariableUse {
  name: string; operator: string; prefix: number | null; explode: boolean;
  expressionIndex: number; span: Span;
}
export interface VariableProfile {
  name: string; occurrences: number; firstSpan: Span; lastSpan: Span;
  scalarOnly: boolean; usesExplode: boolean; usesReserved: boolean;
  usesQuery: boolean; usesFragment: boolean; maximumPrefix: number | null;
  operators: string[]; prefixes: number[]; uses: VariableUse[];
}
export interface TemplateAnalysis {
  offsetUnit: 'unicode-code-point'; maxLevel: number;
  hasReservedExpansion: boolean; hasFragment: boolean;
  expressions: Array<{ operator: string; level: number; span: Span; variables: string[] }>;
  uses: VariableUse[]; profiles: VariableProfile[];
}
export interface TemplateComparison {
  offsetUnit: 'unicode-code-point'; sourceChanged: boolean; requiresReview: boolean;
  addedVariables: string[]; removedVariables: string[]; becameScalarOnly: string[];
  becameCompositeCapable: string[]; newRepeatedVariables: string[];
  oldLevel: number; newLevel: number; reservedAdded: boolean; fragmentAdded: boolean;
  literalsChanged: boolean; expressionLayoutChanged: boolean;
  variableChanges: Array<{
    name: string; before: VariableProfile; after: VariableProfile;
    operatorsChanged: boolean; prefixesChanged: boolean; explodeChanged: boolean;
    occurrencesChanged: boolean; usesChanged: boolean;
  }>;
  addedRequired: string[]; removedRequired: string[];
  rejectUnusedBefore: boolean; rejectUnusedAfter: boolean;
  budgetChanges: Array<{ name: string; before: number; after: number; tightened: boolean }>;
}
export class CompiledTemplate<N extends string = string, R extends N = never> {
  private constructor();
  readonly source: string;
  readonly variables: readonly N[];
  analyze(): TemplateAnalysis;
  /** Review aid; does not certify URL equivalence or application compatibility. */
  compare(newer: CompiledTemplate<any, any>): TemplateComparison;
  expand(variables: Bindings<N, R>): string;
  tryExpand(variables: Bindings<N, R>): ExpansionResult;
  measure(variables: Bindings<N, R>): number;
  trace(variables: Bindings<N, R>): Trace;
  /** Reports unbound optional variables too; this is not a contract verdict. */
  check(variables: Partial<Record<N, Value>>): BindingReport;
  expandMany(inputs: readonly Bindings<N, R>[], limits?: BatchLimits): string[];
}
export function compileTemplate<const S extends string, const R extends TemplateVariables<S> = never>(
  source: S, options?: CompileOptions<TemplateVariables<S>, R>
): CompiledTemplate<TemplateVariables<S>, R>;
export function expand<const S extends string, const R extends TemplateVariables<S> = never>(
  source: S, variables: Bindings<TemplateVariables<S>, R>, options?: CompileOptions<TemplateVariables<S>, R>
): string;
