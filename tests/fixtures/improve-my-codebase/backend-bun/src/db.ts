import { Database } from "bun:sqlite";

const db = new Database(":memory:");

export function setup(): void {
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
}

export function insert(name: string): void {
  db.run("INSERT INTO users (name) VALUES (?)", [name]);
}
