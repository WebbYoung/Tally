import type { AnalysisRecord, Project, Snapshot } from "./types";
import { validateStateShape } from "./backup";
export interface SavedState {
  project: Project;
  snapshots: Snapshot[];
  activeId: string | null;
  analyses?: AnalysisRecord[];
}
let revision: number | undefined;
let queue: Promise<unknown> = Promise.resolve();
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("tally-local", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("workspace");
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("工作空间数据库被其他标签页占用。"));
  });
}
export async function loadState(): Promise<SavedState | null> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("workspace", "readonly"),
      store = tx.objectStore("workspace"),
      value = store.get("current"),
      version = store.get("revision");
    tx.oncomplete = () => {
      d.close();
      try {
        revision = version.result ?? 0;
        if (value.result) validateStateShape(value.result);
        resolve(value.result ?? null);
      } catch (e) {
        reject(e);
      }
    };
    tx.onerror = () => {
      d.close();
      reject(tx.error);
    };
  });
}
export function saveState(state: SavedState): Promise<void> {
  const copy = structuredClone(state);
  const task = queue
    .catch(() => undefined)
    .then(async () => {
      const d = await db();
      return new Promise<void>((resolve, reject) => {
        const tx = d.transaction("workspace", "readwrite"),
          store = tx.objectStore("workspace"),
          request = store.get("revision");
        let conflict = false;
        request.onsuccess = () => {
          const current = request.result ?? 0;
          if (revision === undefined || current !== revision) {
            conflict = true;
            tx.abort();
            return;
          }
          store.put(copy, "current");
          store.put(current + 1, "revision");
        };
        tx.oncomplete = () => {
          revision = (revision ?? 0) + 1;
          d.close();
          resolve();
        };
        tx.onabort = () => {
          d.close();
          reject(
            new Error(
              conflict
                ? "其他标签页已修改工作空间；本页已停止写入，请先导出本页备份，再刷新读取最新数据。"
                : "保存失败，可能已达到浏览器存储配额。",
            ),
          );
        };
        tx.onerror = () => {};
      });
    });
  queue = task;
  return task;
}
