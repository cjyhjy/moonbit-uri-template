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
  templateName?: string;
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
  templateName?: string;
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
  /** Checks the configured business contract; optional omissions are allowed. */
  inspect(variables?: Readonly<Record<string, Value>>, options?: FindingLimits): BindingFinding[];
  audit(policy?: TemplatePolicy, options?: FindingLimits): Diagnostic[];
  expandMany(inputs: readonly Bindings<N, R>[], limits?: BatchLimits): string[];
}
export function compileTemplate<const S extends string, const R extends TemplateVariables<S> = never>(
  source: S, options?: CompileOptions<TemplateVariables<S>, R>
): CompiledTemplate<TemplateVariables<S>, R>;
export function expand<const S extends string, const R extends TemplateVariables<S> = never>(
  source: S, variables: Bindings<TemplateVariables<S>, R>, options?: CompileOptions<TemplateVariables<S>, R>
): string;

export interface FindingLimits { maxFindings?: number; }
export interface BindingFinding extends Diagnostic { variable?: string; }
export interface TemplatePolicy {
  allowReserved?: boolean; allowFragment?: boolean; allowPrefix?: boolean; allowExplode?: boolean;
  allowedVariables?: readonly string[] | null; maxLevel?: number; maxReferences?: number;
  forbidRepeatedVariables?: boolean;
}
export interface CatalogDefinition extends CompileOptions<string, string> { template: string; }
export type CatalogDefinitions = Readonly<Record<string, CatalogDefinition>>;
type CatalogKey<D> = Extract<keyof D, string>;
type RequiredFor<D extends CatalogDefinition> = D extends { requireAll: true }
  ? TemplateVariables<D['template']>
  : D extends { required: readonly (infer R)[] } ? Extract<R, TemplateVariables<D['template']>> : never;
type CatalogBindings<D extends CatalogDefinitions, K extends CatalogKey<D>> =
  Bindings<TemplateVariables<D[K]['template']>, RequiredFor<D[K]>>;
type ValidateCatalog<D extends CatalogDefinitions> = {
  readonly [K in keyof D]: { readonly required?: readonly TemplateVariables<D[K]['template']>[] };
};
export type CatalogRequest<D extends CatalogDefinitions> = {
  [K in CatalogKey<D>]: { template: K; variables: CatalogBindings<D, K>; label?: string };
}[CatalogKey<D>];
export interface InspectionRequest { template: string; variables: Readonly<Record<string, Value>>; label?: string; }
export interface InspectionLimits extends FindingLimits { maxItems?: number; maxTotalInputCodepoints?: number; }
export interface CatalogLimits { maxTemplates?: number; maxTotalTemplateCodepoints?: number; }
export interface CatalogInspection {
  ok: boolean; totalFindings: number;
  requests: Array<{ index: number; template: string; label?: string; findings: BindingFinding[] }>;
}
export interface CatalogAudit {
  ok: boolean; totalFindings: number;
  entries: Array<{ template: string; findings: Diagnostic[] }>;
}
export interface CatalogComparison {
  added: string[]; removed: string[];
  changed: Array<{ template: string; change: TemplateComparison }>;
  totalChanges: number; requiresReview: boolean;
}
export class CompiledCatalog<D extends CatalogDefinitions = CatalogDefinitions> {
  private constructor();
  readonly names: readonly CatalogKey<D>[];
  readonly size: number;
  has(name: string): boolean;
  get<K extends CatalogKey<D>>(name: K): CompiledTemplate<TemplateVariables<D[K]['template']>, RequiredFor<D[K]>>;
  expand<K extends CatalogKey<D>>(name: K, variables: CatalogBindings<D, K>): string;
  measure<K extends CatalogKey<D>>(name: K, variables: CatalogBindings<D, K>): number;
  trace<K extends CatalogKey<D>>(name: K, variables: CatalogBindings<D, K>): Trace;
  templatesUsing(variable: string): CatalogKey<D>[];
  expandMany(requests: readonly CatalogRequest<D>[], budgets?: BatchLimits): string[];
  measureMany(requests: readonly CatalogRequest<D>[], budgets?: BatchLimits): { bytes: number[]; totalBytes: number };
  inspect(requests: readonly InspectionRequest[], options?: InspectionLimits): CatalogInspection;
  audit(policy?: TemplatePolicy, options?: FindingLimits): CatalogAudit;
  compare(newer: CompiledCatalog<any>, options?: { maxChanges?: number }): CatalogComparison;
}
export function compileCatalog<const D extends CatalogDefinitions>(
  definitions: D & ValidateCatalog<D>, options?: CatalogLimits
): CompiledCatalog<D>;
