// Session state as JSON files (ADR-003): data/sessions/<id>/<name>.json, trace.jsonl, blobs/.
// Results worth more than one session, such as a paid web search, go in a Cache:
// data/cache/<area>/<key>.json. Feature code uses these interfaces, never fs.

import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type Store = {
  readDoc<T = unknown>(sessionId: string, name: string): T | undefined;
  writeDoc(sessionId: string, name: string, value: unknown): void;
  deleteDoc(sessionId: string, name: string): void;
  // Deletes every document of the session, keeping its trace and blobs: readers fall back to the
  // seed, so this restores the seeded state.
  clearDocs(sessionId: string): void;
  appendTrace(sessionId: string, event: { id: string }): void;
  // Events in append order; with `after`, only those that follow that event id.
  readTrace<E extends { id: string } = { id: string }>(sessionId: string, after?: string): E[];
  writeBlob(sessionId: string, value: unknown): string;
  readBlob<T = unknown>(sessionId: string, ref: string): T;
};

// Outside every session: a sim reset or a new session reads the same values.
export type Cache = {
  read<T = unknown>(area: string, key: string): T | undefined;
  write(area: string, key: string, value: unknown): void;
};

export const DATA_DIR = join(process.cwd(), "data");

// Names content by a short hash of it: a cache key, or a step key that changes with its input.
export const contentHash = (material: unknown) =>
  createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 12);

const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

// A session id or document name the store refuses: a client error, not a server fault.
export class InvalidNameError extends Error {}

function checked(kind: string, value: string): string {
  if (!SAFE_NAME.test(value)) throw new InvalidNameError(`Invalid ${kind} "${value}"`);
  return value;
}

function readJson<T>(path: string): T | undefined {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : undefined;
}

// Write a temp file, then rename it, so a crash never leaves a half-written document.
function writeAtomic(path: string, text: string) {
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

function forWrite(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

export function createFileCache(root: string = DATA_DIR): Cache {
  const path = (area: string, key: string) =>
    join(root, "cache", checked("cache area", area), `${checked("cache key", key)}.json`);
  return {
    read: (area, key) => readJson(path(area, key)),
    write(area, key, value) {
      writeAtomic(forWrite(path(area, key)), `${JSON.stringify(value, null, 2)}\n`);
    },
  };
}

export function createFileStore(root: string = DATA_DIR): Store {
  const sessionPath = (sessionId: string, ...parts: string[]) =>
    join(root, "sessions", checked("session id", sessionId), ...parts);
  const docPath = (sessionId: string, name: string) =>
    sessionPath(sessionId, `${checked("document name", name)}.json`);
  const blobPath = (sessionId: string, ref: string) => {
    if (!/^blob_[0-9a-f]{16}$/.test(ref)) throw new Error(`Invalid blob ref "${ref}"`);
    return sessionPath(sessionId, "blobs", `${ref}.json`);
  };

  return {
    readDoc: (sessionId, name) => readJson(docPath(sessionId, name)),
    writeDoc(sessionId, name, value) {
      writeAtomic(forWrite(docPath(sessionId, name)), `${JSON.stringify(value, null, 2)}\n`);
    },
    deleteDoc(sessionId, name) {
      rmSync(docPath(sessionId, name), { force: true });
    },
    clearDocs(sessionId) {
      const dir = sessionPath(sessionId);
      if (!existsSync(dir)) return;
      for (const name of readdirSync(dir)) {
        if (name.endsWith(".json")) rmSync(join(dir, name));
      }
    },
    appendTrace(sessionId, event) {
      appendFileSync(forWrite(sessionPath(sessionId, "trace.jsonl")), `${JSON.stringify(event)}\n`);
    },
    readTrace<E extends { id: string }>(sessionId: string, after?: string): E[] {
      const path = sessionPath(sessionId, "trace.jsonl");
      if (!existsSync(path)) return [];
      const events = readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as E);
      const index = after ? events.findIndex((e) => e.id === after) : -1;
      return events.slice(index + 1);
    },
    writeBlob(sessionId, value) {
      const text = JSON.stringify(value);
      const ref = `blob_${createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
      writeAtomic(forWrite(blobPath(sessionId, ref)), text);
      return ref;
    },
    readBlob<T>(sessionId: string, ref: string): T {
      const value = readJson<T>(blobPath(sessionId, ref));
      if (value === undefined) throw new Error(`No blob ${ref} in session ${sessionId}`);
      return value;
    },
  };
}
