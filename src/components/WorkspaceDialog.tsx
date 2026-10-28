import { useState } from "react";
import { X, Download, Upload, ShieldCheck } from "lucide-react";
import { exportBackup, parseBackup } from "../domain/backup";
import type { SavedState } from "../domain/storage";
export function WorkspaceDialog({
  state,
  onClose,
  onRestore,
}: {
  state: SavedState | null;
  onClose: () => void;
  onRestore: (state: SavedState) => Promise<void>;
}) {
  const [pending, setPending] = useState<SavedState | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ack, setAck] = useState(false),
    [replace, setReplace] = useState(false),
    [message, setMessage] = useState("");
  async function backup() {
    if (!state) return;
    setBusy(true);
    try {
      await exportBackup(state);
      setMessage("完整备份已下载，包含源记录、全部版本和已保存分析。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function inspect(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    setPending(null);
    setReplace(false);
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error("备份超过 100 MB。");
      setPending(await parseBackup(await file.text()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal workspace-modal"
        role="dialog"
        aria-modal="true"
        aria-label="工作空间与备份"
      >
        <button
          className="modal-close"
          onClick={onClose}
          aria-label="关闭备份窗口"
        >
          <X />
        </button>
        <h2>工作空间与备份</h2>
        <p>
          完整备份可跨浏览器恢复活动、源记录、版本和图表。报告与证据 JSON
          只用于复核，不能恢复工作空间。
        </p>
        {error && (
          <div role="alert" className="alert error">
            {error}
          </div>
        )}
        {message && (
          <div role="status" className="inline-notice">
            {message}
          </div>
        )}
        <div className="fact-box">
          <ShieldCheck size={19} />
          <p>
            {state
              ? `${state.project.name} · ${state.snapshots.length} 个版本 · ${state.analyses?.length ?? 0} 项分析`
              : "当前没有活动，可从完整备份恢复。"}
          </p>
          <small>
            备份未加密，包含原始人员标识与表格内容。仅保存在你的设备，不会发送到
            AI。请勿当作公开报告分享。
          </small>
        </div>
        <label className="consent">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
          />
          我了解完整备份含原始数据，会妥善保存。
        </label>
        <button
          className="button primary"
          disabled={!state || !ack || busy}
          onClick={backup}
        >
          <Download size={16} />
          下载完整备份
        </button>
        <hr />
        <label className="button secondary">
          <Upload size={16} />
          选择完整备份文件
          <input
            aria-label="恢复完整备份文件"
            type="file"
            accept=".json"
            disabled={busy}
            onChange={(e) => {
              inspect(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <p className="subtle">
          只读取 .tally.json 格式，校验文件摘要、版本指纹和证据引用。100 MB、100
          个版本、500 项分析以内；摘要校验不代表文件来自可信作者。
        </p>
        {pending && (
          <div className="fact-box">
            <strong>待恢复：{pending.project.name}</strong>
            <p>
              {pending.snapshots.length} 个版本 ·{" "}
              {pending.project.sources.length} 个数据源 ·{" "}
              {pending.analyses?.length ?? 0} 项分析
            </p>
            <label className="consent">
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
              />
              已备份需要保留的数据，确认用此备份替换当前工作空间。
            </label>
            <button
              className="button primary"
              disabled={!replace || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onRestore(pending);
                  onClose();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              确认恢复工作空间
            </button>
          </div>
        )}
        {busy && <p role="status">正在校验或保存，请勿关闭页面…</p>}
      </section>
    </div>
  );
}
