import path from "node:path";

export function resolvePath(value: string, yamlDir: string): string {
  const expanded = value.startsWith("~")
    ? value.replace(/^~/, process.env.HOME ?? "")
    : value;
  return path.isAbsolute(expanded) ? expanded : path.resolve(yamlDir, expanded);
}
