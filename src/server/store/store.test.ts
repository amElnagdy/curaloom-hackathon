import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFileStore } from "./store";

const tempRoot = () => mkdtempSync(join(tmpdir(), "store-"));

describe("file store", () => {
  it("keeps documents across a restart", () => {
    const root = tempRoot();
    createFileStore(root).writeDoc("s_1", "profile", { name: "عمر" });

    expect(createFileStore(root).readDoc("s_1", "profile")).toEqual({ name: "عمر" });
  });

  it("returns undefined for a document never written", () => {
    expect(createFileStore(tempRoot()).readDoc("s_1", "plan-v1")).toBeUndefined();
  });

  it("replaces a document whole and leaves no temp files", () => {
    const root = tempRoot();
    const store = createFileStore(root);
    store.writeDoc("s_1", "profile", { name: "a", extra: 1 });
    store.writeDoc("s_1", "profile", { name: "b" });

    expect(store.readDoc("s_1", "profile")).toEqual({ name: "b" });
    expect(readdirSync(join(root, "sessions/s_1")).sort()).toEqual(["profile.json"]);
  });

  it("clears a session's documents but keeps its trace and blobs", () => {
    const store = createFileStore(tempRoot());
    store.writeDoc("s_1", "profile", { name: "عمر" });
    store.writeDoc("s_2", "profile", { name: "سارة" });
    store.appendTrace("s_1", { id: "evt_0001" });
    const ref = store.writeBlob("s_1", { big: "x" });

    store.clearDocs("s_1");
    store.clearDocs("s_9");

    expect(store.readDoc("s_1", "profile")).toBeUndefined();
    expect(store.readDoc("s_2", "profile")).toEqual({ name: "سارة" });
    expect(store.readTrace("s_1").map((e) => e.id)).toEqual(["evt_0001"]);
    expect(store.readBlob("s_1", ref)).toEqual({ big: "x" });
  });

  it("returns trace events in append order, after a cursor, across a restart", () => {
    const root = tempRoot();
    const store = createFileStore(root);
    for (const id of ["evt_0001", "evt_0002", "evt_0003"]) store.appendTrace("s_1", { id });

    const reloaded = createFileStore(root);
    expect(reloaded.readTrace("s_1").map((e) => e.id)).toEqual([
      "evt_0001",
      "evt_0002",
      "evt_0003",
    ]);
    expect(reloaded.readTrace("s_1", "evt_0001").map((e) => e.id)).toEqual([
      "evt_0002",
      "evt_0003",
    ]);
    expect(reloaded.readTrace("s_2")).toEqual([]);
  });

  it("creates nothing on disk when reading a session that does not exist", () => {
    const root = tempRoot();
    const store = createFileStore(root);
    store.readDoc("s_9", "profile");
    store.readTrace("s_9");

    expect(readdirSync(root)).toEqual([]);
  });

  it("stores large payloads as blobs referenced by id", () => {
    const store = createFileStore(tempRoot());
    const ref = store.writeBlob("s_1", { big: "x".repeat(10_000) });

    expect(ref).toMatch(/^blob_[0-9a-f]{16}$/);
    expect(store.readBlob("s_1", ref)).toEqual({ big: "x".repeat(10_000) });
  });

  it("rejects session ids and names that could escape the session folder", () => {
    const store = createFileStore(tempRoot());

    expect(() => store.writeDoc("../etc", "profile", {})).toThrow(/session id/);
    expect(() => store.writeDoc("s_1", "../../x", {})).toThrow(/document name/);
    expect(() => store.readBlob("s_1", "blob_../../x")).toThrow(/blob/);
  });
});
