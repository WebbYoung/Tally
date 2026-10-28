import { describe, it, expect, beforeEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { demoProject } from "../src/domain/demo";
import {
  executePlan,
  hashText,
  identityFingerprint,
  reconcile,
} from "../src/domain/engine";
import { parseBackup, serializeBackup } from "../src/domain/backup";
import { ENGINE_VERSION, type Snapshot } from "../src/domain/types";
import type { SavedState } from "../src/domain/storage";
async function state(): Promise<SavedState> {
  const p = await demoProject();
  const s: Snapshot = {
    id: "v1",
    label: "v1",
    createdAt: "2026-10-27",
    project: p,
    result: reconcile(p),
    fingerprint: await identityFingerprint(p),
    engineVersion: ENGINE_VERSION,
  };
  const plan = {
    metric: "attendanceRate",
    groupBy: "channel",
    order: "desc",
    title: "渠道",
  } as const;
  return {
    project: p,
    snapshots: [s],
    activeId: "v1",
    analyses: [
      {
        id: "a1",
        snapshotId: "v1",
        createdAt: "2026-10-27",
        plan,
        rows: executePlan(plan, s.result, p),
      },
    ],
  };
}
describe("完整备份", () => {
  it("源记录、历史结果、分析与活动状态往返保留", async () => {
    const original = await state();
    expect(await parseBackup(await serializeBackup(original))).toEqual(
      original,
    );
  });
  it("拒绝损坏文件及证据 JSON 冒充备份", async () => {
    const raw = JSON.parse(await serializeBackup(await state()));
    raw.state.project.name = "tampered";
    await expect(parseBackup(JSON.stringify(raw))).rejects.toThrow("校验");
    await expect(parseBackup('{"metrics":{}}')).rejects.toThrow("不是受支持");
    await expect(parseBackup("oops")).rejects.toThrow("JSON");
  });
  it("即使重算外层校验和，版本指纹或引用损坏也被拦截", async () => {
    const s = await state();
    s.snapshots[0].fingerprint = "0".repeat(64);
    await expect(parseBackup(await serializeBackup(s))).rejects.toThrow("指纹");
    const r = await state();
    r.analyses![0].rows[0].evidence[0].row = 999;
    await expect(parseBackup(await serializeBackup(r))).rejects.toThrow(
      "证据引用",
    );
  });
  it("拒绝分析指向不存在版本", async () => {
    const s = await state();
    s.analyses![0].snapshotId = "missing";
    await expect(parseBackup(await serializeBackup(s))).rejects.toThrow(
      "不存在",
    );
  });
});
describe("IndexedDB 提交保护", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", new IDBFactory());
  });
  it("连续异步保存按顺序提交，刷新读取最后一版", async () => {
    const storage = await import("../src/domain/storage");
    expect(await storage.loadState()).toBeNull();
    const s = await state();
    const t = structuredClone(s);
    t.project.name = "最后一次修改";
    await Promise.all([storage.saveState(s), storage.saveState(t)]);
    expect((await storage.loadState())?.project.name).toBe("最后一次修改");
  });
  it("其他标签页已写入时拒绝覆盖，保留远端更新", async () => {
    const storage = await import("../src/domain/storage");
    await storage.loadState();
    const s = await state();
    await storage.saveState(s);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("tally-local", 1);
      req.onsuccess = () => {
        const db = req.result,
          tx = db.transaction("workspace", "readwrite");
        tx.objectStore("workspace").put(99, "revision");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    await expect(storage.saveState(s)).rejects.toThrow("其他标签页");
  });
});
