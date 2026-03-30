import { readFileSync, writeFileSync, existsSync } from "node:fs";

export async function readFile(path: string): Promise<string> {
  return readFileSync(path, "utf-8");
}

export async function readJsonFile<T = unknown>(path: string): Promise<T> {
  return JSON.parse(readFileSync(path, "utf-8"));
}

export async function writeFile(path: string, content: string): Promise<void> {
  writeFileSync(path, content);
}

export async function fileExists(path: string): Promise<boolean> {
  return existsSync(path);
}
