import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

/** Read and parse a YAML config file from web/config (Node contexts only). */
export function loadYaml(file: string): unknown {
  return parse(readFileSync(path.join(process.cwd(), "config", file), "utf8")) as unknown;
}
