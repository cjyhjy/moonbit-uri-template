// Local Octokit integration experiment; URL expansion uses the published SDK.
import { compileTemplate } from "moonbit-uri-template";

export function parseUrl(template: string) {
  const compiled = compileTemplate(template);
  return {
    expand(context: Record<string, any>): string {
      // Octokit passes body/query options alongside URL variables. Do not send
      // unrelated values (for example binary request bodies) to the URI SDK.
      const variables: Record<string, any> = Object.create(null);
      for (const name of compiled.variables) {
        const value = context[name];
        // Octokit accepts bigint IDs; the JSON-based SDK accepts decimal text.
        variables[name] = typeof value === "bigint" ? value.toString() : value;
      }
      const url = compiled.expand(variables);
      // Preserve Octokit's existing trailing-slash convention, including root.
      return url === "/" ? url : url.replace(/\/$/, "");
    },
  };
}
