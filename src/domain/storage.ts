import type { AnalysisRecord, Project, Snapshot } from "./types";
export interface SavedState {
  project: Project;
  snapshots: Snapshot[];
  activeId: string | null;
  analyses?: AnalysisRecord[];
}
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("tally-local", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("workspace");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadState(): Promise<SavedState | null> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("workspace", "readonly");
    const req = tx.objectStore("workspace").get("current");
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => d.close();
  });
}
export async function saveState(state: SavedState) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = d.transaction("workspace", "readwrite");
    tx.objectStore("workspace").put(state, "current");
    tx.oncomplete = () => {
      d.close();
      resolve();
    };
    tx.onerror = () => {
      d.close();
      reject(tx.error);
    };
  });
}
