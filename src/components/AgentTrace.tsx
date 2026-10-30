import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  X,
} from "lucide-react";
import type { AgentOutcome, AgentStep, AgentStepKind } from "../domain/agent";

const STEP_LABELS: Record<AgentStepKind, string> = {
  probe: "探查数据",
  retrieve: "检索口径",
  decide: "决策",
  build: "组装计划",
  verify: "自检",
  revise: "修正",
  commit: "定稿",
};

const STATUS_TONE: Record<AgentStep["status"], string> = {
  ok: "green",
  running: "neutral",
  failed: "red",
  skipped: "neutral",
};

function StepIcon({ status }: { status: AgentStep["status"] }) {
  if (status === "ok") return <Check size={14} />;
  if (status === "failed") return <X size={14} />;
  if (status === "running") return <LoaderCircle size={14} className="spin" />;
  return <span className="trace-dash">–</span>;
}

export function AgentTrace({
  outcome,
  open,
  onToggle,
}: {
  outcome: AgentOutcome;
  open: boolean;
  onToggle: () => void;
}) {
  const calls = outcome.usage.calls;
  const tokens = outcome.usage.prompt + outcome.usage.completion;
  const headline =
    outcome.status === "plan"
      ? "AI 已生成计划"
      : outcome.status === "rejected"
        ? "AI 判定无法用现有工具回答"
        : "AI 调用失败";
  return (
    <section className="panel trace-panel">
      <div className="panel-head">
        <div>
          <span className={`badge ${outcome.status === "plan" ? "green" : "amber"}`}>
            {headline}
          </span>
          <h2>AI 工作过程</h2>
          <p>
            {outcome.steps.length} 步 · {outcome.citations.length} 条口径 ·{" "}
            {calls} 次模型调用 · {tokens} tokens
            {outcome.revised ? " · 经过一次自检修正" : ""}
          </p>
        </div>
        <button
          className="trace-toggle"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? "收起工作过程" : "展开工作过程"}
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>
      {outcome.status !== "plan" && outcome.reason && (
        <p className="trace-reason">{outcome.reason}</p>
      )}
      {open && (
        <ol className="trace-steps">
          {outcome.steps.map((step) => (
            <li key={step.id} className={`trace-step ${step.status}`}>
              <span className={`badge ${STATUS_TONE[step.status]}`}>
                <StepIcon status={step.status} />
                {STEP_LABELS[step.kind] ?? step.kind}
              </span>
              <div className="trace-body">
                <strong>{step.title}</strong>
                <span className="subtle">{step.detail}</span>
                {step.tool && (
                  <code className="trace-tool">
                    {step.tool}
                    {step.latencyMs === undefined ? "" : ` · ${step.latencyMs}ms`}
                  </code>
                )}
                {step.citations && step.citations.length > 0 && (
                  <span className="trace-cites">
                    依据 {step.citations.join("、")}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {open && outcome.citations.length > 0 && (
        <div className="trace-citations">
          <h3>引用口径</h3>
          <ul>
            {outcome.citations.map((c) => (
              <li key={c.id}>
                <code>{c.id}</code> {c.title}
              </li>
            ))}
          </ul>
        </div>
      )}
      {outcome.droppedCitations.length > 0 && (
        <p className="trace-warn">
          <AlertTriangle size={14} />
          已丢弃无法核验的引用：{outcome.droppedCitations.join("、")}
        </p>
      )}
    </section>
  );
}
