import { useEffect, useMemo, useState, useRef, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Database,
  FileSpreadsheet,
  FileText,
  Filter,
  GitCompareArrows,
  History,
  LayoutDashboard,
  Link2,
  ListChecks,
  LoaderCircle,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
  AlertTriangle,
  CheckCircle2,
  Rows3,
} from "lucide-react";
import {
  DEFAULT_POLICY,
  ENGINE_VERSION,
  FIELD_LABELS,
  ROLE_LABELS,
  type AnalysisRow,
  type Claim,
  type Field,
  type Metric,
  type MetricKey,
  type Plan,
  type Project,
  type Ref,
  type Role,
  type Snapshot,
  type Source,
} from "./domain/types";
import {
  checkClaim,
  claimsFor,
  compareRows,
  executePlan,
  formatValue,
  identityFingerprint,
  mappingError,
  metricDependencyChanges,
  planSchema,
  reconcile,
} from "./domain/engine";
import { demoProject } from "./domain/demo";
import { downloadSources, readSpreadsheet } from "./domain/files";
import { loadState, saveState } from "./domain/storage";
import { exportEvidence, exportReport } from "./domain/report";
import type { AnalysisRecord } from "./domain/types";
import type { SavedState } from "./domain/storage";
import { WorkspaceDialog } from "./components/WorkspaceDialog";

type Page =
  "overview" | "import" | "review" | "analysis" | "versions" | "report";
const nav = [
  { id: "overview" as Page, label: "活动概览", icon: LayoutDashboard },
  { id: "import" as Page, label: "导入与映射", icon: FileSpreadsheet },
  { id: "review" as Page, label: "数据核对", icon: ListChecks },
  { id: "analysis" as Page, label: "提问与分析", icon: Sparkles },
  { id: "versions" as Page, label: "版本与检查", icon: GitCompareArrows },
  { id: "report" as Page, label: "复盘报告", icon: FileText },
];
const metricNames = {
  attendanceRate: "已报名人员到场率",
  registered: "有效报名人数",
  attended: "总到场人数",
  feedbackRate: "反馈回收率",
  satisfaction: "平均满意度",
};
const presets: Plan[] = [
  {
    metric: "attendanceRate",
    groupBy: "channel",
    order: "desc",
    title: "哪些报名渠道的到场率最高？",
  },
  {
    metric: "attended",
    groupBy: "grade",
    order: "desc",
    title: "不同年级有多少报名者到场？",
  },
  {
    metric: "feedbackRate",
    groupBy: "channel",
    order: "desc",
    title: "各渠道已到场者的反馈回收率是多少？",
  },
  {
    metric: "satisfaction",
    groupBy: "none",
    order: "desc",
    title: "有效反馈的平均满意度是多少？",
  },
];
const issueNames: Record<string, string> = {
  missingId: "身份缺失",
  duplicateRegistration: "重复报名",
  duplicateAttendance: "重复签到",
  duplicateFeedback: "重复反馈",
  overlap: "跨文件重叠",
  walkIn: "未报名到场",
  unmatchedFeedback: "未匹配反馈",
  invalidRating: "无效评分",
};
const dateText = (s: string) =>
  new Date(s).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
function Badge({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Database size={36} />
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [page, setPage] = useState<Page>("overview");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [showPolicy, setShowPolicy] = useState(false);
  const [evidence, setEvidence] = useState<{
    title: string;
    refs: Ref[];
    formula?: string;
  } | null>(null);
  const [evidencePage, setEvidencePage] = useState(0);
  const [question, setQuestion] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisRow[] | null>(null);
  const [ai, setAi] = useState<{ available: boolean; model?: string }>({
    available: false,
  });
  const [consent, setConsent] = useState(false);
  const [mappingConsent, setMappingConsent] = useState(false);
  const [diffLimit, setDiffLimit] = useState(12);
  const [issueFilter, setIssueFilter] = useState("all");
  const [issueLimit, setIssueLimit] = useState(15);
  const [compareId, setCompareId] = useState("");
  const [testFault, setTestFault] = useState(false);
  const [pendingSources, setPendingSources] = useState<Source[]>([]);
  const [pendingIndex, setPendingIndex] = useState(0);
  const [replaceRole, setReplaceRole] = useState(true);
  const [storageError, setStorageError] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [persistStatus, setPersistStatus] = useState("已保存");
  const persisted = useRef<SavedState | null>(null);
  const aiRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    if (aiRequest.current) {
      aiRequest.current.abort();
      aiRequest.current = null;
      setBusy("");
    }
  }, [project, activeId, page, question]);
  useEffect(() => () => aiRequest.current?.abort(), []);
  useEffect(() => {
    if (page === "import") setActiveId(null);
  }, [page]);

  useEffect(() => {
    let disposed = false;
    loadState()
      .then((s) => {
        if (disposed) return;
        if (s) {
          persisted.current = s;
          setProject(s.project);
          setSnapshots(s.snapshots);
          setActiveId(s.activeId);
          setAnalyses(s.analyses ?? []);
        }
      })
      .catch(
        (e) =>
          !disposed &&
          setStorageError(
            e instanceof Error ? e.message : "本地存储不可用。请导出完整备份。",
          ),
      )
      .finally(() => {
        if (!disposed) setLoaded(true);
      });
    // 静态部署（GitHub Pages）没有网关进程，直接标记为不可用，避免一次注定 404 的探测请求。
    if (import.meta.env.VITE_STATIC === "1") {
      setAi({ available: false });
    } else
      fetch("/api/status")
        .then((r) => r.json())
        .then((value) => {
          if (!disposed) setAi(value);
        })
        .catch(() => {
          if (!disposed) setAi({ available: false });
        });
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    if (loaded && project && !storageError && !restoring) {
      if (
        persisted.current?.project === project &&
        persisted.current?.snapshots === snapshots &&
        persisted.current?.activeId === activeId &&
        persisted.current?.analyses === analyses
      )
        return;
      setPersistStatus("待保存");
      const state = { project, snapshots, activeId, analyses };
      let cancelled = false;
      const timer = setTimeout(() => {
        setPersistStatus("保存中");
        saveState(state)
          .then(() => {
            persisted.current = state;
            if (!cancelled) setPersistStatus("已保存");
          })
          .catch((e) =>
            setStorageError(
              e instanceof Error ? e.message : "保存失败，请导出完整备份。",
            ),
          );
      }, 400);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }
  }, [project, snapshots, activeId, analyses, loaded, storageError, restoring]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (persistStatus !== "已保存" || storageError) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [persistStatus, storageError]);
  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(""), 4500);
      return () => clearTimeout(t);
    }
  }, [message]);
  const active = snapshots.find((s) => s.id === activeId);
  const display = active?.project ?? project;
  const policyProject = active?.project ?? project;
  const draftResult = useMemo(
    () => (project ? reconcile(project) : null),
    [project],
  );
  const result = active?.result ?? draftResult;
  const latest = snapshots.at(-1);
  const comparison =
    snapshots.find((s) => s.id === compareId) ?? snapshots.at(-2);
  const selectedIssues =
    result?.issues.filter(
      (i) => issueFilter === "all" || i.kind === issueFilter,
    ) ?? [];
  const mapCounts = Object.fromEntries(
    Object.keys(issueNames).map((k) => [
      k,
      result?.issues.filter((i) => i.kind === k).length ?? 0,
    ]),
  );
  const edit = (change: (p: Project) => Project) => {
    if (project) {
      setProject(change(structuredClone(active?.project ?? project)));
      setActiveId(null);
      setAnalysis(null);
      setError("");
    }
  };
  const openEvidence = (title: string, refs: Ref[], formula?: string) => {
    setEvidence({ title, refs, formula });
    setEvidencePage(0);
  };
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : "操作失败，请重试。");

  async function loadDemo() {
    setBusy("正在建立示例");
    try {
      const p = await demoProject();
      const r = reconcile(p);
      const s: Snapshot = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        label: "v1",
        project: structuredClone(p),
        result: r,
        fingerprint: await identityFingerprint(p),
        engineVersion: ENGINE_VERSION,
      };
      setProject(p);
      setSnapshots([s]);
      setAnalyses([]);
      setActiveId(s.id);
      setPage("overview");
      setError("");
      setPlan(null);
      setAnalysis(null);
      setMessage("已载入虚构示例 · 可下载原始表格核对");
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  }
  async function saveVersion() {
    if (snapshots.length >= 100) {
      setError(
        "当前活动已达到 100 个确认版本，请先导出完整备份，再创建新活动。",
      );
      return;
    }
    if (!project || !draftResult?.ready) {
      setError("请先导入必需表格、确认映射并处理待核对记录。");
      return;
    }
    setBusy("正在保存版本");
    try {
      const fingerprint = await identityFingerprint(project);
      if (latest?.fingerprint === fingerprint) {
        setActiveId(latest.id);
        setMessage("数据与口径没有变化，已打开现有版本。");
        return;
      }
      const s: Snapshot = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        label: `v${snapshots.length + 1}`,
        project: structuredClone(project),
        result: structuredClone(draftResult),
        fingerprint,
        engineVersion: ENGINE_VERSION,
      };
      setSnapshots((old) => [...old, s]);
      setActiveId(s.id);
      setMessage(`${s.label} 已创建，正在保存到本地；旧版本保持不变。`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  }
  async function importFile(file: File | undefined, role: Role) {
    if (!file) return;
    setBusy(`正在解析 ${file.name}`);
    setError("");
    try {
      const list = await readSpreadsheet(file, role);
      if (
        list.every((s) =>
          project?.sources.some(
            (old) => old.hash === s.hash && old.sheet === s.sheet,
          ),
        )
      ) {
        throw new Error("该文件的工作表已导入，本次不会增加重复记录。");
      }
      setPendingSources(list);
      setPendingIndex(0);
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  }
  function acceptSource() {
    const s = pendingSources[pendingIndex];
    if (!s) return;
    if (
      (project?.sources.filter((old) => !replaceRole || old.role !== s.role)
        .length ?? 0) >= 30
    ) {
      setError("每个活动最多保留 30 个数据源，请使用替换同类表格功能。");
      return;
    }
    if (
      project?.sources.some(
        (old) => old.hash === s.hash && old.sheet === s.sheet,
      )
    ) {
      setError("该工作表已存在，不能重复导入。");
      return;
    }
    edit((p) => ({
      ...p,
      sources: [
        ...p.sources.filter((old) => !replaceRole || old.role !== s.role),
        s,
      ],
    }));
    setPendingSources([]);
    setMessage("文件已在本地解析，请确认字段映射。");
  }
  async function aiMapping(source: Source) {
    if (!mappingConsent) {
      setError("请先在本页确认 AI 数据发送范围。");
      return;
    }
    setBusy("AI 正在建议字段映射");
    aiRequest.current?.abort();
    const request = new AbortController();
    aiRequest.current = request;
    try {
      const r = await fetch("/api/mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headers: source.headers }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
      });
      const data = await r.json();
      if (request.signal.aborted) return;
      if (!r.ok) throw new Error(data.error);
      edit((p) => ({
        ...p,
        sources: p.sources.map((s) =>
          s.id === source.id
            ? { ...s, mapping: data.mapping, confirmed: false }
            : s,
        ),
      }));
      setMessage("AI 建议已填入，请人工核对后确认。");
    } catch (e) {
      if (!request.signal.aborted) fail(e);
    } finally {
      if (aiRequest.current === request) {
        aiRequest.current = null;
        setBusy("");
      }
    }
  }
  async function ask() {
    if (!question.trim()) return;
    if (!ai.available) {
      setError(
        "云端 AI 尚未配置。请使用下方预设分析，或按 README 配置模型服务。",
      );
      return;
    }
    if (!consent) {
      setError(
        "发送前请勾选确认：仅发送提问与规范字段列表。请勿在提问中填写个人信息。",
      );
      return;
    }
    setBusy("AI 正在规划统计参数");
    setError("");
    setPlan(null);
    setAnalysis(null);
    aiRequest.current?.abort();
    const request = new AbortController();
    aiRequest.current = request;
    try {
      const fields = [
        ...new Set(
          (display?.sources ?? [])
            .filter((s) => s.confirmed)
            .flatMap((s) =>
              Object.entries(s.mapping)
                .filter(
                  ([field, header]) =>
                    header &&
                    s.headers.includes(header) &&
                    ((field !== "channel" && field !== "grade") ||
                      s.role === "registration"),
                )
                .map(([field]) => field),
            ),
        ),
      ];
      const r = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, fields }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
      });
      const data = await r.json();
      if (request.signal.aborted) return;
      if (!r.ok) throw new Error(data.error);
      setPlan(planSchema.parse(data.plan));
    } catch (e) {
      if (!request.signal.aborted) fail(e);
    } finally {
      if (aiRequest.current === request) {
        aiRequest.current = null;
        setBusy("");
      }
    }
  }
  function runAnalysis() {
    if (!plan || !result || !display) return;
    try {
      const rows = executePlan(plan, result, display);
      setAnalysis(rows);
      if (active) {
        if (
          analyses.length >= 500 &&
          !analyses.some(
            (a) =>
              a.snapshotId === active.id &&
              JSON.stringify(a.plan) === JSON.stringify(plan),
          )
        )
          throw new Error("已达到 500 项分析，请导出备份后再继续。");
        const record: AnalysisRecord = {
          id: crypto.randomUUID(),
          snapshotId: active.id,
          createdAt: new Date().toISOString(),
          plan: structuredClone(plan),
          rows: structuredClone(rows),
        };
        setAnalyses((old) => [
          ...old.filter(
            (a) =>
              a.snapshotId !== active.id ||
              JSON.stringify(a.plan) !== JSON.stringify(plan),
          ),
          record,
        ]);
        setMessage("分析已保存到当前版本，可在历史分析中回放并导出。");
      } else
        setMessage("当前为草稿分析；保存确认版本后重新执行，即可随报告导出。");
      setError("");
    } catch (e) {
      setAnalysis(null);
      fail(e);
    }
  }
  function createProject() {
    if (!newName.trim()) return;
    setProject({
      name: newName.trim(),
      date: newDate,
      demo: false,
      sources: [],
      policy: structuredClone(DEFAULT_POLICY),
    });
    setSnapshots([]);
    setAnalyses([]);
    setActiveId(null);
    setNewOpen(false);
    setPage("import");
    setPlan(null);
    setAnalysis(null);
    setError("");
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("overview");
          }}
        >
          <span className="brand-icon">
            <CheckCheck size={25} />
          </span>
          <span>
            对表 <small>TALLY</small>
          </span>
        </a>
        <div className="workspace-label">校园活动工作空间</div>
        <button className="workspace-switch" onClick={() => setNewOpen(true)}>
          <span className="avatar">校</span>
          <span>
            活动复盘工作台<small>本地工作空间</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-label">工作台</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "nav-item active" : "nav-item"}
              onClick={() => {
                setPage(n.id);
                setError("");
              }}
            >
              <n.icon size={19} />
              {n.label}
              {n.id === "review" && result && result.issues.length > 0 && (
                <span className="nav-count">{result.issues.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-box">
            <ShieldCheck size={21} />
            <strong>数据留在你的浏览器</strong>
            <p>原始表格在本地核对。AI 请求内容由你确认。</p>
          </div>
          <button
            className="help-link"
            onClick={() => {
              setPage("analysis");
              setError(
                "云端 AI 需配置服务端环境变量。预设分析、本地核对、版本与导出无需 API。详见仓库 README。",
              );
            }}
          >
            <CircleHelp size={17} />
            使用与数据说明
            <ArrowUpRight size={14} />
          </button>
          <div className="user">
            <span className="avatar dark">我</span>
            <span>
              我的工作空间<small>单用户 · 本地保存</small>
            </span>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            工作台
            <ChevronRight size={14} />
            <strong>{nav.find((n) => n.id === page)?.label}</strong>
          </div>
          <div className="top-actions">
            <span className="local-status">
              <span className="online-dot" />
              {storageError ? "保存异常" : "本地" + persistStatus}
            </span>
            <button
              className="icon-button"
              aria-label="指标口径设置"
              onClick={() => setShowPolicy(true)}
            >
              <Settings2 size={19} />
            </button>
            <span className="avatar round">我</span>
            <button
              className="icon-button"
              aria-label="工作空间与备份"
              onClick={() => setWorkspaceOpen(true)}
            >
              <Database size={19} />
            </button>
          </div>
        </header>
        <main>
          {storageError && (
            <div role="alert" className="alert error">
              {storageError}
            </div>
          )}
          {error && (
            <div role="alert" className="alert error">
              <AlertTriangle size={18} />
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="关闭错误">
                <X size={16} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "overview"
                  ? "ACTIVITY OVERVIEW"
                  : page === "analysis"
                    ? "ASK YOUR DATA"
                    : "TALLY WORKSPACE"}
              </div>
              <h1>
                {page === "overview"
                  ? "每个结论，都有据可查。"
                  : nav.find((n) => n.id === page)?.label}
              </h1>
              <p>
                {page === "overview"
                  ? "把分散的活动数据，变成清晰、可信的复盘。"
                  : page === "import"
                    ? "先确认每列的含义，再让数据彼此对上。"
                    : page === "review"
                      ? "看见差异，确认处理方式，让每一次计算有依据。"
                      : page === "analysis"
                        ? "用你的问题组织分析，由确定的计算支撑回答。"
                        : page === "versions"
                          ? "保留过去的结果，看清这一次为什么不同。"
                          : "把统计口径和证据一起带进报告。"}
              </p>
            </div>
            <div className="heading-actions">
              {project && (
                <button
                  className="button secondary"
                  onClick={() => {
                    setNewOpen(true);
                    setNewName("");
                  }}
                >
                  <Plus size={16} />
                  新建活动
                </button>
              )}
              {project && (
                <button
                  className="button primary"
                  onClick={saveVersion}
                  disabled={!!busy || !draftResult?.ready}
                >
                  <Check size={16} />
                  {active ? "确认并保存版本" : "保存确认版本"}
                </button>
              )}
            </div>
          </div>
          {!loaded ? (
            <Empty
              title="正在打开本地工作空间"
              body="读取已保存的数据与版本…"
            />
          ) : !project ? (
            <section className="welcome panel">
              <div>
                <Badge>LOCAL FIRST · EVIDENCE ALWAYS</Badge>
                <h2>
                  从三张表开始，
                  <br />
                  把一次活动看清楚。
                </h2>
                <p>
                  导入报名、签到和反馈，核对数据差异，确认统计口径。
                  <br />
                  让你的每个数字，都能回到原始记录。
                </p>
                <div className="button-row">
                  <button
                    className="button primary"
                    onClick={() => setNewOpen(true)}
                  >
                    <Plus size={18} />
                    创建第一个活动
                  </button>
                  <button
                    className="button secondary"
                    onClick={loadDemo}
                    disabled={!!busy}
                  >
                    体验完整示例
                    <ArrowRight size={16} />
                  </button>
                </div>
                <small>示例为虚构校园活动数据，不消耗 AI 额度。</small>
              </div>
              <div className="welcome-graphic">
                <div className="sample-file">
                  <FileSpreadsheet />
                  报名名单<span>300 人</span>
                </div>
                <div className="sample-file">
                  <FileSpreadsheet />
                  现场签到<span>240 条</span>
                </div>
                <div className="sample-file">
                  <FileSpreadsheet />
                  活动反馈<span>90 份</span>
                </div>
                <div className="sample-result">
                  <CheckCheck />
                  核对后到场率
                  <strong>
                    60<span>%</span>
                  </strong>
                  <small>180 名报名者到场 / 300 人报名</small>
                </div>
              </div>
            </section>
          ) : (
            <>
              <div className="activity-strip">
                <div className="activity-icon">
                  <BarChart3 size={21} />
                </div>
                <div>
                  <strong>{display?.name}</strong>
                  <span>
                    {display?.date || "未填写日期"}
                    <i />
                    单场活动
                    {display?.demo && (
                      <>
                        <i />
                        虚构示例
                      </>
                    )}
                  </span>
                </div>
                <Badge tone={active ? "green" : "amber"}>
                  {active ? `${active.label} · 已确认` : "草稿 · 暂算"}
                </Badge>
                <div className="activity-right">
                  <span>
                    <FileSpreadsheet size={15} />
                    {display?.sources.length ?? 0} 个数据源
                  </span>
                  <button
                    className="text-button"
                    onClick={() => setShowPolicy(true)}
                  >
                    口径 v{display?.policy.version}
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>
              {active && active.id !== latest?.id && (
                <div className="alert amber">
                  正在查看历史版本 {active.label}。
                  <button
                    className="text-button"
                    onClick={() => {
                      setActiveId(latest?.id ?? null);
                      setAnalysis(null);
                    }}
                  >
                    返回最新版本
                  </button>
                </div>
              )}
              {page === "overview" && result && (
                <>
                  <div className="metrics-grid">
                    {(
                      [
                        "registered",
                        "attended",
                        "attendanceRate",
                        "duplicates",
                        "walkIns",
                        "feedbackRate",
                      ] as MetricKey[]
                    ).map((key, i) => {
                      const m = result.metrics[key];
                      return (
                        <button
                          className={`metric-card ${key === "attendanceRate" ? "featured" : ""}`}
                          key={key}
                          onClick={() =>
                            openEvidence(
                              m.label,
                              [...m.evidence, ...m.denominatorEvidence],
                              m.formula,
                            )
                          }
                        >
                          <div className="metric-top">
                            <span>
                              M{i + 1} ·{" "}
                              {key === "feedbackRate" ? "反馈情况" : m.label}
                            </span>
                            <ArrowUpRight size={15} />
                          </div>
                          <div className="metric-value">
                            {formatValue(m.value)}
                            <span>{m.unit}</span>
                          </div>
                          <div className="metric-foot">
                            {key === "attendanceRate"
                              ? `${m.numerator} / ${m.denominator} · 已报名人员`
                              : key === "attended"
                                ? `含 ${result.metrics.walkIns.value} 名未报名到场者`
                                : key === "feedbackRate"
                                  ? `平均评分 ${formatValue(result.metrics.satisfaction.value)} / ${display?.policy.ratingMax}`
                                  : key === "duplicates"
                                    ? "按确认规则保留一条"
                                    : "点击查看计算依据"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="overview-grid">
                    <section className="panel analysis-panel">
                      <div className="panel-head">
                        <div>
                          <h2>
                            从问题开始复盘 <Sparkles size={17} />
                          </h2>
                          <p>先看分析计划，再看数字与依据。</p>
                        </div>
                        <Badge tone="neutral">
                          {ai.available ? "AI 已连接" : "预设分析可用"}
                        </Badge>
                      </div>
                      <div className="question-entry">
                        <Search size={19} />
                        <input
                          aria-label="想了解的活动问题"
                          value={question}
                          onChange={(e) => setQuestion(e.target.value)}
                          placeholder="例如：哪些报名渠道的到场率最高？"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") setPage("analysis");
                          }}
                        />
                        <button
                          className="arrow-button"
                          aria-label="进入提问分析"
                          onClick={() => setPage("analysis")}
                        >
                          <ArrowRight size={19} />
                        </button>
                      </div>
                      <div className="suggestions">
                        {presets.slice(0, 3).map((p) => (
                          <button
                            key={p.title}
                            onClick={() => {
                              setPlan(p);
                              setAnalysis(null);
                              setPage("analysis");
                            }}
                          >
                            {p.title}
                            <ArrowUpRight size={13} />
                          </button>
                        ))}
                      </div>
                      <div className="workflow">
                        <span>
                          <CheckCircle2 />
                          理解问题
                        </span>
                        <ChevronRight />
                        <span>
                          <Settings2 />
                          确认口径
                        </span>
                        <ChevronRight />
                        <span>
                          <BarChart3 />
                          执行计算
                        </span>
                        <ChevronRight />
                        <span>
                          <Link2 />
                          查看证据
                        </span>
                      </div>
                    </section>
                    <section className="panel quality-panel">
                      <div className="panel-head">
                        <h2>数据核对状态</h2>
                        <ShieldCheck size={20} />
                      </div>
                      <div className="quality-total">
                        <strong>
                          {
                            result.issues.filter(
                              (i) =>
                                i.kind === "missingId" || i.kind === "overlap",
                            ).length
                          }
                        </strong>
                        <span>项需要人工处理</span>
                        <Badge tone={result.ready ? "green" : "amber"}>
                          {result.ready ? "可保存版本" : "待确认"}
                        </Badge>
                      </div>
                      <div className="quality-line">
                        <span>重复签到记录</span>
                        <strong>{result.metrics.duplicates.value} 条</strong>
                      </div>
                      <div className="quality-line">
                        <span>未报名到场</span>
                        <strong>{result.metrics.walkIns.value} 人</strong>
                      </div>
                      <div className="quality-line">
                        <span>有效评分样本</span>
                        <strong>
                          {result.metrics.satisfaction.denominator} 份
                        </strong>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => setPage("review")}
                      >
                        打开核对工作台
                        <ArrowRight size={15} />
                      </button>
                    </section>
                  </div>
                  <div className="lower-grid">
                    <section className="panel">
                      <div className="panel-head">
                        <div>
                          <h2>数据源</h2>
                          <p>文件内容保留在此浏览器中</p>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => setPage("import")}
                        >
                          管理数据
                          <ArrowRight size={14} />
                        </button>
                      </div>
                      <SourceList sources={display?.sources ?? []} />
                      {!display?.sources.length && (
                        <Empty
                          title="还没有数据"
                          body="导入报名表与签到表，开始第一次核对。"
                          action={
                            <button
                              className="button primary"
                              onClick={() => setPage("import")}
                            >
                              导入表格
                            </button>
                          }
                        />
                      )}
                    </section>
                    <section className="panel">
                      <div className="panel-head">
                        <h2>版本记录</h2>
                        <History size={18} />
                      </div>
                      {snapshots
                        .slice(-3)
                        .reverse()
                        .map((s) => (
                          <button
                            className="version-list-item"
                            key={s.id}
                            onClick={() => {
                              setActiveId(s.id);
                              setAnalysis(null);
                              setPage("versions");
                            }}
                          >
                            <span className="version-dot" />
                            <span>
                              <strong>{s.label} · 已确认快照</strong>
                              <small>
                                {dateText(s.createdAt)} · 口径 v
                                {s.project.policy.version}
                              </small>
                            </span>
                            <ChevronRight size={16} />
                          </button>
                        ))}
                      {!snapshots.length && (
                        <p className="muted">
                          确认字段和口径后保存第一个版本。
                        </p>
                      )}
                      <div className="hint">
                        <Link2 size={15} />
                        每个版本保留原始依据与计算结果
                      </div>
                    </section>
                  </div>
                  <footer className="workspace-footer">
                    <span>
                      <ShieldCheck size={14} />
                      事实性复盘 · 不从统计差异推断原因
                    </span>
                    {display?.demo && (
                      <button
                        className="text-button"
                        onClick={() => downloadSources(display.sources)}
                      >
                        下载示例原始表格
                        <ArrowDownToLine size={14} />
                      </button>
                    )}
                  </footer>
                </>
              )}
              {page === "import" && (
                <>
                  <div className="upload-grid">
                    {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                      <label className="upload-card" key={role}>
                        <span className="file-icon">
                          <FileSpreadsheet size={24} />
                        </span>
                        <strong>{ROLE_LABELS[role]}</strong>
                        <p>
                          {role === "registration"
                            ? "人员标识、渠道、年级"
                            : role === "attendance"
                              ? "人员标识、签到时间"
                              : "人员标识（可选）、满意度"}
                        </p>
                        <span className="button secondary">
                          <Upload size={15} />
                          选择文件
                        </span>
                        <input
                          aria-label={`上传${ROLE_LABELS[role]}`}
                          type="file"
                          accept=".csv,.xlsx"
                          disabled={!!busy}
                          onChange={(e) => {
                            importFile(e.target.files?.[0], role);
                            e.currentTarget.value = "";
                          }}
                        />
                        <small>CSV / XLSX · 单文件 ≤ 10 MB</small>
                      </label>
                    ))}
                  </div>
                  <div className="inline-notice">
                    <ShieldCheck size={18} />
                    文件在浏览器解析。首版保护上限为单表 20,000 行、100
                    列；不代表已验证所有设备的性能。
                  </div>
                  <label className="consent">
                    <input
                      type="checkbox"
                      checked={mappingConsent}
                      onChange={(e) => setMappingConsent(e.target.checked)}
                    />
                    允许按需向已配置的 AI
                    发送本页所选文件的表头名称；不发送原始行记录。表头中请勿填写个人信息。
                  </label>
                  {project.sources.map((s) => (
                    <section className="panel mapping-panel" key={s.id}>
                      <div className="panel-head">
                        <div>
                          <h2>
                            <FileSpreadsheet size={19} />
                            {s.name}
                            <Badge tone="neutral">{ROLE_LABELS[s.role]}</Badge>
                          </h2>
                          <p>
                            {s.sheet} · {s.rows.length} 行 · SHA-256{" "}
                            {s.hash.slice(0, 16)}…
                          </p>
                        </div>
                        <div className="button-row">
                          <button
                            className="button secondary"
                            disabled={!ai.available || !!busy}
                            onClick={() => aiMapping(s)}
                          >
                            <Sparkles size={15} />
                            AI 建议
                          </button>
                          <button
                            className="text-button danger"
                            onClick={() =>
                              edit((p) => ({
                                ...p,
                                sources: p.sources.filter((x) => x.id !== s.id),
                              }))
                            }
                          >
                            移除此表
                          </button>
                        </div>
                      </div>
                      <div className="mapping-grid">
                        {(Object.keys(FIELD_LABELS) as Field[])
                          .filter((f) =>
                            s.role === "registration"
                              ? ["id", "channel", "grade"].includes(f)
                              : s.role === "attendance"
                                ? ["id", "time"].includes(f)
                                : ["id", "rating"].includes(f),
                          )
                          .map((f) => (
                            <label key={f}>
                              {FIELD_LABELS[f]}
                              {f === "id" && s.role !== "feedback" && " *"}
                              <select
                                value={s.mapping[f] ?? ""}
                                onChange={(e) =>
                                  edit((p) => ({
                                    ...p,
                                    sources: p.sources.map((x) =>
                                      x.id === s.id
                                        ? {
                                            ...x,
                                            mapping: {
                                              ...x.mapping,
                                              [f]: e.target.value || undefined,
                                            },
                                            confirmed: false,
                                          }
                                        : x,
                                    ),
                                  }))
                                }
                              >
                                <option value="">未指定</option>
                                {s.headers.map((h) => (
                                  <option key={h}>{h}</option>
                                ))}
                              </select>
                            </label>
                          ))}
                      </div>
                      {s.warnings.map((w) => (
                        <div className="alert amber" key={w}>
                          {w}
                        </div>
                      ))}
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>原始行</th>
                              {s.headers.slice(0, 8).map((h) => (
                                <th key={h}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {s.rows.slice(0, 3).map((r) => (
                              <tr key={r.rowNumber}>
                                <td>{r.rowNumber}</td>
                                {s.headers.slice(0, 8).map((h) => (
                                  <td key={h}>{r.values[h] || "—"}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="mapping-foot">
                        <span className="muted">
                          以上为前三条预览 · 表头建议为本地规则匹配，AI
                          建议需单独触发
                        </span>
                        <button
                          className={`button ${s.confirmed ? "secondary" : "primary"}`}
                          onClick={() => {
                            const mappingProblem = mappingError(s);
                            if (mappingProblem) {
                              setError(mappingProblem);
                              return;
                            }
                            if (s.role !== "feedback" && !s.mapping.id) {
                              setError("报名与签到表必须指定可靠的人员标识。");
                              return;
                            }
                            if (s.role === "feedback" && !s.mapping.rating) {
                              setError("请指定满意度评分列。");
                              return;
                            }
                            edit((p) => ({
                              ...p,
                              sources: p.sources.map((x) =>
                                x.id === s.id ? { ...x, confirmed: true } : x,
                              ),
                            }));
                          }}
                        >
                          <Check size={15} />
                          {s.confirmed ? "映射已确认" : "确认字段映射"}
                        </button>
                      </div>
                    </section>
                  ))}
                </>
              )}
              {page === "review" && result && (
                <>
                  <div className="section-toolbar">
                    <div>
                      <h2>
                        核对问题{" "}
                        <span className="muted">{result.issues.length}</span>
                      </h2>
                      <p className="muted">
                        重复记录按口径处理；跨文件重叠和身份缺失需人工确认。
                      </p>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => setShowPolicy(true)}
                    >
                      <Settings2 size={16} />
                      处理规则
                    </button>
                  </div>
                  {result.warnings.map((w) => (
                    <div className="alert amber" key={w}>
                      <AlertTriangle size={17} />
                      {w}
                    </div>
                  ))}
                  <div className="filter-tabs">
                    <button
                      className={issueFilter === "all" ? "selected" : ""}
                      onClick={() => {
                        setIssueFilter("all");
                        setIssueLimit(15);
                      }}
                    >
                      全部 {result.issues.length}
                    </button>
                    {Object.entries(issueNames)
                      .filter(([k]) => mapCounts[k] > 0)
                      .map(([k, v]) => (
                        <button
                          className={issueFilter === k ? "selected" : ""}
                          key={k}
                          onClick={() => {
                            setIssueFilter(k);
                            setIssueLimit(15);
                          }}
                        >
                          {v} {mapCounts[k]}
                        </button>
                      ))}
                  </div>
                  <section className="panel issue-panel">
                    {selectedIssues.slice(0, issueLimit).map((i, n) => (
                      <div
                        className="issue-row"
                        key={i.kind + i.refs[0]?.key + n}
                      >
                        <span
                          className={`issue-icon ${["missingId", "overlap"].includes(i.kind) ? "amber" : "neutral"}`}
                        >
                          <Filter size={19} />
                        </span>
                        <div className="issue-copy">
                          <strong>
                            {issueNames[i.kind]}
                            <Badge
                              tone={
                                ["missingId", "overlap"].includes(i.kind)
                                  ? "amber"
                                  : "neutral"
                              }
                            >
                              {["missingId", "overlap"].includes(i.kind)
                                ? "待确认"
                                : "已按口径识别"}
                            </Badge>
                          </strong>
                          <p>{i.message}</p>
                          <small>
                            {i.refs
                              .map((r) => `${r.file} 第 ${r.row} 行`)
                              .slice(0, 3)
                              .join(" · ")}
                          </small>
                          {["missingId", "overlap"].includes(i.kind) && (
                            <div className="button-row">
                              {i.refs.map((r) => (
                                <button
                                  className="small-button"
                                  key={r.key}
                                  onClick={() =>
                                    edit((p) => ({
                                      ...p,
                                      policy: {
                                        ...p.policy,
                                        version: p.policy.version + 1,
                                        excludedRefs: [
                                          ...new Set([
                                            ...p.policy.excludedRefs,
                                            r.key,
                                          ]),
                                        ],
                                      },
                                    }))
                                  }
                                >
                                  排除第 {r.row} 行（{r.file}）
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          className="text-button"
                          onClick={() =>
                            openEvidence(issueNames[i.kind], i.refs)
                          }
                        >
                          查看记录
                          <ChevronRight size={15} />
                        </button>
                      </div>
                    ))}
                    {!selectedIssues.length && (
                      <Empty
                        title="没有这类核对问题"
                        body="请同时检查字段映射和统计口径是否符合活动实际情况。"
                      />
                    )}
                    {selectedIssues.length > issueLimit && (
                      <button
                        className="button secondary load-more"
                        onClick={() => setIssueLimit((n) => n + 30)}
                      >
                        继续显示（剩余 {selectedIssues.length - issueLimit} 项）
                      </button>
                    )}
                  </section>
                  {!!project.policy.excludedRefs.length && (
                    <div className="inline-notice">
                      已排除 {project.policy.excludedRefs.length} 条记录。
                      <button
                        className="text-button"
                        onClick={() =>
                          edit((p) => ({
                            ...p,
                            policy: {
                              ...p.policy,
                              version: p.policy.version + 1,
                              excludedRefs: [],
                            },
                          }))
                        }
                      >
                        撤销全部排除（生成草稿）
                      </button>
                    </div>
                  )}
                </>
              )}
              {page === "analysis" && result && (
                <>
                  <section className="panel ask-panel">
                    <div className="panel-head">
                      <h2>
                        <Sparkles size={19} />
                        问一个关于活动的问题
                      </h2>
                      <Badge tone={ai.available ? "green" : "neutral"}>
                        {ai.available ? `AI · ${ai.model}` : "云端 AI 未配置"}
                      </Badge>
                    </div>
                    <div className="question-entry large">
                      <Search size={21} />
                      <input
                        aria-label="分析问题"
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") ask();
                        }}
                        placeholder="哪些报名渠道的到场率最高？"
                      />
                      <button
                        className="button primary"
                        disabled={!!busy || !question.trim()}
                        onClick={ask}
                      >
                        生成分析计划
                        <ArrowRight size={16} />
                      </button>
                    </div>
                    <label className="consent">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      本次将发送我的提问与规范字段列表，不发送原始数据。请勿在提问中填写个人信息。
                    </label>
                    <div className="suggestions">
                      {presets.map((p) => (
                        <button
                          key={p.title}
                          onClick={() => {
                            setPlan(p);
                            setAnalysis(null);
                            setError("");
                          }}
                        >
                          {p.title}
                          <ArrowUpRight size={13} />
                        </button>
                      ))}
                    </div>
                    <p className="subtle">
                      推荐问题直接使用预设参数，不依赖模型；只有点击“生成分析计划”才会请求
                      AI。
                    </p>
                  </section>
                  {plan && (
                    <section className="panel plan-panel">
                      <div className="panel-head">
                        <div>
                          <Badge tone="neutral">
                            {analysis
                              ? "已执行 · 可修改参数"
                              : "待确认 · 不自动执行"}
                          </Badge>
                          <h2>{plan.title}</h2>
                        </div>
                        <Settings2 size={22} />
                      </div>
                      <div className="mapping-grid">
                        <label>
                          统计指标
                          <select
                            value={plan.metric}
                            onChange={(e) => {
                              setPlan({
                                ...plan,
                                metric: e.target.value as Plan["metric"],
                              });
                              setAnalysis(null);
                            }}
                          >
                            {Object.entries(metricNames).map(([k, v]) => (
                              <option value={k} key={k}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          分组字段
                          <select
                            value={plan.groupBy}
                            onChange={(e) => {
                              setPlan({
                                ...plan,
                                groupBy: e.target.value as Plan["groupBy"],
                              });
                              setAnalysis(null);
                            }}
                          >
                            <option value="none">总体，不分组</option>
                            <option value="channel">报名渠道</option>
                            <option value="grade">年级</option>
                          </select>
                        </label>
                        <label>
                          排序
                          <select
                            value={plan.order}
                            onChange={(e) => {
                              setPlan({
                                ...plan,
                                order: e.target.value as Plan["order"],
                              });
                              setAnalysis(null);
                            }}
                          >
                            <option value="desc">数值从高到低</option>
                            <option value="asc">数值从低到高</option>
                          </select>
                        </label>
                      </div>
                      <div className="plan-scope">
                        <ShieldCheck size={18} />
                        <div>
                          <strong>执行范围与口径</strong>
                          <p>
                            {result.metrics[plan.metric].formula}。
                            {plan.groupBy !== "none"
                              ? "分组属性来自报名表，仅统计可匹配到报名表的人员；缺失分组单独列出。"
                              : ""}
                            仅使用已确认的有效记录。
                          </p>
                        </div>
                      </div>
                      <button className="button primary" onClick={runAnalysis}>
                        <BarChart3 size={16} />
                        确认参数并执行
                      </button>
                    </section>
                  )}
                  {analysis && plan && (
                    <section className="panel chart-panel">
                      <div className="panel-head">
                        <div>
                          <h2>{metricNames[plan.metric]}</h2>
                          <p>
                            确定性工具执行 · {active?.label ?? "当前草稿"} ·
                            口径 v{display?.policy.version}
                          </p>
                        </div>
                        <Badge>
                          <Check size={12} />
                          计算完成
                        </Badge>
                      </div>
                      <div className="bar-chart">
                        {analysis.map((row) => (
                          <button
                            key={row.name}
                            className="chart-row"
                            onClick={() =>
                              openEvidence(
                                `${row.name} · ${metricNames[plan.metric]}`,
                                [...row.evidence, ...row.denominatorEvidence],
                                `${row.numerator}${row.denominator ? " ÷ " + row.denominator : ""}${plan.metric.endsWith("Rate") ? " × 100%" : ""}`,
                              )
                            }
                          >
                            <span>{row.name}</span>
                            <div className="bar-track">
                              <div
                                className="bar-fill"
                                style={{
                                  width: `${row.value === null ? 0 : Math.max(2, (row.value / Math.max(1, ...analysis.map((r) => r.value ?? 0))) * 100)}%`,
                                }}
                              />
                            </div>
                            <strong>
                              {formatValue(row.value)}
                              {result.metrics[plan.metric].unit}
                            </strong>
                            <Link2 size={14} />
                          </button>
                        ))}
                      </div>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>分组</th>
                              <th>数值</th>
                              <th>分子 / 评分总和</th>
                              <th>分母 / 有效评分数</th>
                              <th>证据</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analysis.map((row) => (
                              <tr key={row.name}>
                                <td>{row.name}</td>
                                <td>
                                  {formatValue(row.value)}
                                  {result.metrics[plan.metric].unit}
                                </td>
                                <td>{row.numerator}</td>
                                <td>{row.denominator || "—"}</td>
                                <td>
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      openEvidence(row.name, [
                                        ...row.evidence,
                                        ...row.denominatorEvidence,
                                      ])
                                    }
                                  >
                                    查看原始行
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="fact-box">
                        <Badge>数据事实 · 程序生成</Badge>
                        <p>
                          {analysis
                            .filter((r) => r.value !== null)
                            .map(
                              (r) =>
                                `${r.name}：${formatValue(r.value)}${result.metrics[plan.metric].unit}${r.denominator ? `（${r.numerator} / ${r.denominator}）` : ""}`,
                            )
                            .join("；") || "当前分组没有可计算结果。"}
                        </p>
                        <small>
                          这些结果描述现有数据，不证明渠道、年级与到场行为之间存在因果关系。人数较少的分组应谨慎比较。
                        </small>
                      </div>
                    </section>
                  )}
                </>
              )}
              {page === "analysis" &&
                active &&
                analyses.some((a) => a.snapshotId === active.id) && (
                  <section className="panel">
                    <h2>当前版本已保存的分析</h2>
                    {analyses
                      .filter((a) => a.snapshotId === active.id)
                      .map((a) => (
                        <button
                          key={a.id}
                          className="version-list-item"
                          onClick={() => {
                            setPlan(a.plan);
                            setAnalysis(a.rows);
                          }}
                        >
                          <BarChart3 size={18} />
                          <span>
                            <strong>{a.plan.title}</strong>
                            <small>
                              {dateText(a.createdAt)} · 点击原样回放 ·
                              将随报告导出
                            </small>
                          </span>
                          <ArrowRight size={16} />
                        </button>
                      ))}
                  </section>
                )}
              {page === "versions" && (
                <>
                  {!latest ? (
                    <Empty
                      title="还没有确认版本"
                      body="完成字段确认与数据核对后，点击“保存确认版本”。"
                    />
                  ) : (
                    <>
                      <div className="section-toolbar">
                        <h2>版本对照</h2>
                        <div className="button-row">
                          <select
                            aria-label="选择对照版本"
                            value={comparison?.id ?? ""}
                            onChange={(e) => setCompareId(e.target.value)}
                          >
                            <option value="">选择旧版本</option>
                            {snapshots
                              .filter((s) => s.id !== latest.id)
                              .map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.label} · {dateText(s.createdAt)}
                                </option>
                              ))}
                          </select>
                          <span className="muted">对照最新 {latest.label}</span>
                        </div>
                      </div>
                      <section className="panel">
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>指标</th>
                                <th>{comparison?.label ?? "无旧版本"}</th>
                                <th>{latest.label} 最新</th>
                                <th>变化</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.values(latest.result.metrics).map((m) => {
                                const old = comparison?.result.metrics[m.key];
                                return (
                                  <tr key={m.key}>
                                    <td>{m.label}</td>
                                    <td>
                                      {formatValue(old?.value ?? null)}
                                      {m.unit}
                                    </td>
                                    <td>
                                      <strong>
                                        {formatValue(m.value)}
                                        {m.unit}
                                      </strong>
                                    </td>
                                    <td>
                                      {!old ? (
                                        "—"
                                      ) : old.value === m.value ? (
                                        <Badge tone="neutral">未变化</Badge>
                                      ) : (
                                        <Badge tone="amber">已变化</Badge>
                                      )}
                                      {old &&
                                        old.value !== m.value &&
                                        formatValue(old.value) ===
                                          formatValue(m.value) && (
                                          <small className="precise-change">
                                            显示值经四舍五入；原值{" "}
                                            {String(old.value)} →{" "}
                                            {String(m.value)}
                                          </small>
                                        )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {comparison && (
                          <div className="version-details">
                            <p>
                              数据行变化：
                              {
                                compareRows(comparison.project, latest.project)
                                  .length
                              }{" "}
                              项 · 口径 v{comparison.project.policy.version} → v
                              {latest.project.policy.version}
                            </p>
                            {compareRows(comparison.project, latest.project)
                              .slice(0, diffLimit)
                              .map((d) => (
                                <details className="row-diff" key={d.key}>
                                  <summary>
                                    {d.kind} · {d.key} · {d.before} → {d.after}{" "}
                                    条
                                  </summary>
                                  <div className="diff-columns">
                                    {[
                                      {
                                        label: comparison.label,
                                        rows: d.beforeRows,
                                      },
                                      {
                                        label: latest.label,
                                        rows: d.afterRows,
                                      },
                                    ].map((side) => (
                                      <div key={side.label}>
                                        <strong>{side.label}</strong>
                                        {side.rows.length ? (
                                          side.rows.map((row, i) => (
                                            <p key={i}>
                                              {row.file} / {row.sheet} 第{" "}
                                              {row.row} 行<br />
                                              {Object.entries(row.values)
                                                .map(([k, v]) => `${k}：${v}`)
                                                .join("；")}
                                            </p>
                                          ))
                                        ) : (
                                          <p>无对应记录</p>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              ))}
                            {compareRows(comparison.project, latest.project)
                              .length > diffLimit && (
                              <button
                                className="button secondary"
                                onClick={() => setDiffLimit((n) => n + 30)}
                              >
                                显示更多行变化
                              </button>
                            )}
                            <p className="subtle">
                              重复标识或匿名记录不进行确定性行匹配；旧结果不重算，由快照还原。
                            </p>
                          </div>
                        )}
                      </section>
                      <div className="section-toolbar">
                        <div>
                          <h2>结论检查</h2>
                          <p className="muted">
                            核验
                            {comparison
                              ? `${comparison.label} 的结论在 ${latest.label} 中是否仍然适用`
                              : "当前版本的数字与证据引用"}
                            。
                          </p>
                        </div>
                        <button
                          className="button secondary"
                          onClick={() => setTestFault((v) => !v)}
                        >
                          <AlertTriangle size={16} />
                          {testFault ? "关闭测试注入" : "运行故障注入测试"}
                        </button>
                      </div>
                      {testFault && (
                        <div className="alert amber">
                          测试模式：仅在内存副本中故意修改第一条结论数值、删除证据并加入因果措辞。保存版本和原始数据不受影响。
                        </div>
                      )}
                      <section className="panel">
                        {claimsFor(comparison ?? latest).map((claim, index) => {
                          const c: Claim =
                            testFault && index === 0
                              ? {
                                  ...claim,
                                  value: (claim.value ?? 0) + 7,
                                  evidence: [],
                                  text: "因为渠道宣传导致报名人数改变（故障测试句）",
                                }
                              : claim;
                          const check = checkClaim(
                            c,
                            comparison ?? latest,
                            latest,
                          );
                          return (
                            <div className="claim-row" key={c.id}>
                              <div>
                                <strong>
                                  {testFault && index === 0
                                    ? `${c.text} · 测试值 ${c.value}`
                                    : c.text}
                                </strong>
                                <small>
                                  {c.metric} · 来源{" "}
                                  {(comparison ?? latest).label}
                                </small>
                                {check.stale && (
                                  <small>
                                    需重核原因：
                                    {metricDependencyChanges(
                                      c.metric,
                                      comparison ?? latest,
                                      latest,
                                    ).join("；")}
                                  </small>
                                )}
                              </div>
                              <div className="claim-badges">
                                <Badge tone={check.numeric ? "green" : "red"}>
                                  数字{check.numeric ? "一致" : "不一致"}
                                </Badge>
                                <Badge tone={check.refsValid ? "green" : "red"}>
                                  引用{check.refsValid ? "完整" : "无效"}
                                </Badge>
                                <Badge tone={check.stale ? "amber" : "neutral"}>
                                  {check.stale
                                    ? "依赖已变 · 需重核"
                                    : "当前可用"}
                                </Badge>
                                {check.causalReview && (
                                  <Badge tone="amber">
                                    因果措辞 · 人工审查
                                  </Badge>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </section>
                      <p className="subtle">
                        数字与引用采用程序规则核验。因果表达采用关键词提示，可能误报或漏报，不代表自动识别因果关系。只核对每个指标实际依赖的表格和口径；相关文件内容变化时仍保守要求重核，并说明原因。
                      </p>
                    </>
                  )}
                  <section className="panel history-panel">
                    <h2>所有版本</h2>
                    {snapshots.map((s) => (
                      <button
                        className="version-list-item"
                        key={s.id}
                        onClick={() => {
                          setActiveId(s.id);
                          setAnalysis(null);
                          setPage("overview");
                        }}
                      >
                        <History size={18} />
                        <span>
                          <strong>
                            {s.label} · {s.project.name}
                          </strong>
                          <small>
                            {dateText(s.createdAt)} ·{" "}
                            {s.fingerprint.slice(0, 16)}…
                          </small>
                        </span>
                        <ArrowRight size={16} />
                      </button>
                    ))}
                  </section>
                </>
              )}
              {page === "report" && (
                <>
                  {!active ? (
                    <Empty
                      title="请先选择或保存一个确认版本"
                      body="报告仅从不可变快照生成，避免把暂算结果当成正式结论。"
                      action={
                        <button
                          className="button primary"
                          disabled={!draftResult?.ready}
                          onClick={saveVersion}
                        >
                          保存当前版本
                        </button>
                      }
                    />
                  ) : (
                    <>
                      <div className="report-actions">
                        <span>
                          <ShieldCheck size={17} />
                          不导出人员标识列 · 请检查自由文本
                        </span>
                        <button
                          className="button secondary"
                          onClick={() => exportEvidence(active, analyses)}
                        >
                          <ArrowDownToLine size={16} />
                          导出证据 JSON
                        </button>
                        <button
                          className="button primary"
                          onClick={() => exportReport(active, analyses)}
                        >
                          <ArrowDownToLine size={16} />
                          导出报告 / 打印 PDF
                        </button>
                      </div>
                      <article className="report-paper">
                        <div className="report-brand">
                          对表 TALLY{" "}
                          <span>
                            FACTUAL REVIEW / {active.label.toUpperCase()}
                          </span>
                        </div>
                        <h1>{active.project.name}</h1>
                        <p className="report-subtitle">活动事实性复盘报告</p>
                        <p className="muted">
                          活动日期 {active.project.date} · 生成于{" "}
                          {dateText(active.createdAt)}
                          {active.project.demo ? " · 虚构演示数据" : ""}
                        </p>
                        <hr />
                        <h2>01 / 数据概况</h2>
                        <p>
                          本次分析使用 {active.project.sources.length}{" "}
                          个数据源，共 {active.result.totalRows}{" "}
                          条原始记录。所有指标基于已确认口径 v
                          {active.project.policy.version} 计算。
                        </p>
                        <h2>02 / 核心指标</h2>
                        <table>
                          <thead>
                            <tr>
                              <th>指标</th>
                              <th>结果</th>
                              <th>计算说明</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.values(active.result.metrics).map((m) => (
                              <tr key={m.key}>
                                <td>{m.label}</td>
                                <td>
                                  <strong>
                                    {formatValue(m.value)}
                                    {m.unit}
                                  </strong>
                                </td>
                                <td>{m.formula}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <h2>03 / 证据与限制</h2>
                        <p>
                          结论描述当前数据中的事实，不构成原因解释。反馈回收率依赖实际邀请范围，平均评分仅代表有效回答。
                        </p>
                        <p>
                          本版本已保存{" "}
                          {
                            analyses.filter((a) => a.snapshotId === active.id)
                              .length
                          }{" "}
                          项分析。导出的报告包含分析参数与结果、逐项公式、分子和分母行号、文件哈希与口径版本。打开
                          HTML 报告后，使用“打印 / 保存为 PDF”获得 PDF 文件。
                        </p>
                        <div className="report-stamp">
                          <CheckCheck size={28} />
                          <span>
                            每个数字，都有出处。
                            <small>
                              计算引擎 {active.engineVersion} ·{" "}
                              {active.fingerprint.slice(0, 24)}…
                            </small>
                          </span>
                        </div>
                      </article>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>
      {busy && (
        <div className="busy-pill" role="status">
          <LoaderCircle size={17} className="spin" />
          {busy}
        </div>
      )}
      {message && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {message}
        </div>
      )}
      {workspaceOpen && (
        <WorkspaceDialog
          state={project ? { project, snapshots, activeId, analyses } : null}
          onClose={() => setWorkspaceOpen(false)}
          onRestore={async (restored) => {
            setRestoring(true);
            try {
              await saveState(restored);
              persisted.current = restored;
              setProject(restored.project);
              setSnapshots(restored.snapshots);
              setAnalyses(restored.analyses ?? []);
              setActiveId(restored.activeId);
              setStorageError("");
              setPersistStatus("已保存");
              setPlan(null);
              setAnalysis(null);
              setEvidence(null);
              setPendingSources([]);
              setPage("overview");
              setMessage("完整工作空间已恢复并保存。");
            } finally {
              setRestoring(false);
            }
          }}
        />
      )}
      {newOpen && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="创建活动"
          >
            <button
              className="modal-close"
              onClick={() => setNewOpen(false)}
              aria-label="关闭"
            >
              <X />
            </button>
            <div className="eyebrow">NEW ACTIVITY</div>
            {project && (
              <button
                className="button secondary"
                onClick={() => {
                  setNewOpen(false);
                  setWorkspaceOpen(true);
                }}
              >
                先备份当前活动
              </button>
            )}
            <h2>创建一次新的复盘</h2>
            <p>
              每个工作空间保存一场活动。创建新活动会替换当前工作空间，请先下载完整备份以便恢复历史版本。
            </p>
            <label>
              活动名称
              <input
                value={newName}
                maxLength={80}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例如：校园技术分享会"
                autoFocus
              />
            </label>
            <label>
              活动日期
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
              />
            </label>
            <button
              className="button primary full"
              disabled={!newName.trim()}
              onClick={createProject}
            >
              创建活动
              <ArrowRight size={16} />
            </button>
            {!project && (
              <button
                className="text-button"
                onClick={() => {
                  setNewOpen(false);
                  loadDemo();
                }}
              >
                先体验虚构示例
              </button>
            )}
          </section>
        </div>
      )}
      {showPolicy && policyProject && (
        <div className="modal-backdrop">
          <section
            className="modal policy-modal"
            role="dialog"
            aria-modal="true"
            aria-label="统计口径设置"
          >
            <button
              className="modal-close"
              onClick={() => setShowPolicy(false)}
              aria-label="关闭"
            >
              <X />
            </button>
            <h2>统计口径与处理规则</h2>
            <p>修改仅影响当前草稿，保存后生成新版本。已有版本不会被覆盖。</p>
            <label>
              同场次、同文件重复记录
              <select
                value={policyProject.policy.duplicate}
                onChange={(e) =>
                  edit((p) => ({
                    ...p,
                    policy: {
                      ...p.policy,
                      duplicate: e.target.value as "first" | "last",
                      version: p.policy.version + 1,
                    },
                  }))
                }
              >
                <option value="first">保留原始行序中的首条</option>
                <option value="last">保留原始行序中的末条</option>
              </select>
            </label>
            <label>
              问卷实际发放范围
              <select
                value={policyProject.policy.invitations}
                onChange={(e) =>
                  edit((p) => ({
                    ...p,
                    policy: {
                      ...p.policy,
                      invitations: e.target
                        .value as Project["policy"]["invitations"],
                      version: p.policy.version + 1,
                    },
                  }))
                }
              >
                <option value="unknown">未知：不计算回收率</option>
                <option value="allAttendees">已确认：全部到场者</option>
                <option value="registeredAttendees">
                  已确认：已报名且到场者
                </option>
                <option value="custom">指定受邀到场者名单</option>
              </select>
            </label>
            {policyProject.policy.invitations === "custom" && (
              <label>
                人员标识（每行一人，仅保留在本地）
                <textarea
                  value={policyProject.policy.invitedIds.join("\n")}
                  onChange={(e) =>
                    edit((p) => ({
                      ...p,
                      policy: {
                        ...p.policy,
                        invitedIds: e.target.value.split("\n"),
                        version: p.policy.version + 1,
                      },
                    }))
                  }
                />
                <small>
                  仅统计名单与到场人员交集；不适用于面向缺席者的问卷。
                </small>
              </label>
            )}
            <div className="mapping-grid">
              <label>
                满意度量表最低分
                <input
                  type="number"
                  value={policyProject.policy.ratingMin}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (
                      Number.isFinite(v) &&
                      v < policyProject.policy.ratingMax
                    )
                      edit((p) => ({
                        ...p,
                        policy: {
                          ...p.policy,
                          ratingMin: v,
                          version: p.policy.version + 1,
                        },
                      }));
                  }}
                />
              </label>
              <label>
                最高分
                <input
                  type="number"
                  value={policyProject.policy.ratingMax}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (
                      Number.isFinite(v) &&
                      v > policyProject.policy.ratingMin
                    )
                      edit((p) => ({
                        ...p,
                        policy: {
                          ...p.policy,
                          ratingMax: v,
                          version: p.policy.version + 1,
                        },
                      }));
                  }}
                />
              </label>
            </div>
            <div className="hint">
              身份匹配按已确认标识执行；缺失评分不按零分计算。到场率分子仅包含已报名到场者。
            </div>
            <button
              className="button primary full"
              onClick={() => setShowPolicy(false)}
            >
              完成口径调整
            </button>
          </section>
        </div>
      )}
      {!!pendingSources.length && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="选择工作表"
          >
            <button
              className="modal-close"
              onClick={() => setPendingSources([])}
              aria-label="关闭"
            >
              <X />
            </button>
            <h2>确认导入工作表</h2>
            <label>
              工作表
              <select
                value={pendingIndex}
                onChange={(e) => setPendingIndex(Number(e.target.value))}
              >
                {pendingSources.map((s, i) => (
                  <option value={i} key={s.id}>
                    {s.sheet} · {s.rows.length} 行
                  </option>
                ))}
              </select>
            </label>
            <label className="consent">
              <input
                type="checkbox"
                checked={replaceRole}
                onChange={(e) => setReplaceRole(e.target.checked)}
              />
              替换当前同类表格（旧确认版本仍保留）
            </label>
            <p>取消勾选会追加新来源；跨文件的同人记录需要人工核对。</p>
            <button className="button primary full" onClick={acceptSource}>
              导入所选工作表
            </button>
          </section>
        </div>
      )}
      {evidence && (
        <div className="drawer-backdrop" onClick={() => setEvidence(null)}>
          <aside
            className="evidence-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="证据侧栏"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-head">
              <div>
                <div className="eyebrow">EVIDENCE TRACE</div>
                <h2>{evidence.title}</h2>
              </div>
              <button
                className="icon-button"
                aria-label="关闭证据"
                onClick={() => setEvidence(null)}
              >
                <X />
              </button>
            </div>
            {evidence.formula && (
              <div className="fact-box">
                <strong>计算依据</strong>
                <p>{evidence.formula}</p>
              </div>
            )}
            <p className="muted">
              {evidence.refs.length} 个引用（分子与分母可能引用同一行） ·{" "}
              {active?.label ?? "草稿"}
            </p>
            {evidence.refs
              .slice(evidencePage * 20, (evidencePage + 1) * 20)
              .map((ref, i) => {
                const src = display?.sources.find((s) => s.id === ref.sourceId);
                const row = src?.rows.find((r) => r.rowNumber === ref.row);
                return (
                  <div className="evidence-item" key={ref.key + i}>
                    <strong>
                      <FileSpreadsheet size={16} />
                      {ref.file}
                    </strong>
                    <small>
                      {ref.sheet} · 原始第 {ref.row} 行 · SHA-256{" "}
                      {src?.hash.slice(0, 12)}…
                    </small>
                    <dl>
                      {row ? (
                        Object.entries(row.values).map(([k, v]) => (
                          <div key={k}>
                            <dt>{k}</dt>
                            <dd>{v || "未填写"}</dd>
                          </div>
                        ))
                      ) : (
                        <p>引用未在当前数据中找到。</p>
                      )}
                    </dl>
                  </div>
                );
              })}
            {!evidence.refs.length && (
              <Empty
                title="没有行级证据"
                body="该指标可能缺少输入、分母未知或当前计数为零。"
              />
            )}
            <div className="pagination">
              <button
                className="button secondary"
                disabled={evidencePage === 0}
                onClick={() => setEvidencePage((n) => n - 1)}
              >
                <ArrowLeft size={15} />
                上一页
              </button>
              <span>
                {evidencePage + 1} /{" "}
                {Math.max(1, Math.ceil(evidence.refs.length / 20))}
              </span>
              <button
                className="button secondary"
                disabled={(evidencePage + 1) * 20 >= evidence.refs.length}
                onClick={() => setEvidencePage((n) => n + 1)}
              >
                下一页
                <ArrowRight size={15} />
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function SourceList({ sources }: { sources: Source[] }) {
  return (
    <div className="source-list">
      {sources.map((s) => (
        <div className="source-row" key={s.id}>
          <span className="file-icon">
            <FileSpreadsheet size={22} />
          </span>
          <span>
            <strong>{s.name}</strong>
            <small>
              {s.sheet} · {s.rows.length} 行 · {ROLE_LABELS[s.role]}
            </small>
          </span>
          <Badge tone={s.confirmed ? "green" : "amber"}>
            {s.confirmed ? "已确认" : "待映射"}
          </Badge>
          <span className="source-hash">{s.hash.slice(0, 8)}</span>
        </div>
      ))}
    </div>
  );
}
