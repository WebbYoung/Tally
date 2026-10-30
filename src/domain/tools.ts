import { checkClaim, executePlan, formatValue, planSchema, reconcile } from "./engine";
import { kbBrief, searchKb, toCitation, type KbHit } from "./kb";
import type { Claim, MetricKey, Plan, Project, Ref, Result, Snapshot } from "./types";
import { FIELD_LABELS, ROLE_LABELS } from "./types";

/**
 * 工具契约层。
 *
 * 同一份定义同时供给三条通道：
 *   1. Agent 编排（`agent.ts`）——模型通过 function calling 请求工具
 *   2. MCP server（`server/mcp.mjs`）——外部 MCP 客户端经 stdio 调用
 *   3. 应用内直接调用——UI 的确定性路径
 *
 * 工具只做计算与检索，**不产生任何数字的猜测**：所有数值来自 `engine.ts` 的确定性实现。
 */

export type JsonSchema = Record<string, unknown>;

export interface ToolContext {
  project: Project;
  /** 缺省时按 project 现场重算，保证工具输出与页面一致 */
  result?: Result;
  snapshot?: Snapshot;
}

export interface ToolOutcome {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  /** true 表示需要已核对完成的数据才可执行 */
  needsResult: boolean;
  run(input: Record<string, unknown>, ctx: ToolContext): ToolOutcome;
}

const METRIC_KEYS: MetricKey[] = [
  "registered",
  "attended",
  "attendanceRate",
  "duplicates",
  "walkIns",
  "feedbackRate",
  "satisfaction",
];
const PLAN_METRICS = [
  "attendanceRate",
  "registered",
  "attended",
  "feedbackRate",
  "satisfaction",
] as const;

function result(ctx: ToolContext): Result {
  return ctx.result ?? reconcile(ctx.project);
}

function unavailable(ctx: ToolContext): string | null {
  const r = result(ctx);
  if (!r.ready) {
    const reasons = [
      ...r.warnings.filter((w) => /需导入|请确认|映射/.test(w)),
      ...(r.issues.some((i) => i.kind === "missingId" || i.kind === "overlap")
        ? ["存在身份缺失或跨文件重叠，需先核对。"]
        : []),
    ];
    return (
      "数据尚未就绪，不能计算。" +
      (reasons.length ? reasons.join(" ") : "请先确认字段映射与核对决定。")
    );
  }
  return null;
}

function asRefPreview(refs: Ref[], limit = 5) {
  return refs.slice(0, limit).map((r) => `${r.file}#${r.row}`);
}

/* ───────────────────────────── 1. list_fields ───────────────────────────── */

const listFields: ToolDefinition = {
  name: "list_fields",
  title: "探查可用字段",
  description:
    "列出当前项目已确认的表格、行数与可用规范字段，并给出数据是否就绪。任何分析开始前都应先调用它，不要假设字段存在。",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  needsResult: false,
  run(_input, ctx) {
    const r = result(ctx);
    const fields = [
      ...new Set(
        ctx.project.sources
          .filter((s) => s.confirmed)
          .flatMap((s) =>
            (Object.entries(s.mapping) as [keyof typeof FIELD_LABELS, string][])
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
    return {
      ok: true,
      data: {
        ready: r.ready,
        totalRows: r.totalRows,
        fields,
        fieldLabels: Object.fromEntries(
          fields.map((f) => [f, FIELD_LABELS[f as keyof typeof FIELD_LABELS]]),
        ),
        sources: ctx.project.sources.map((s) => ({
          role: s.role,
          roleLabel: ROLE_LABELS[s.role],
          name: s.name,
          rows: s.rows.length,
          confirmed: s.confirmed,
          mappedFields: Object.keys(s.mapping).filter((k) => s.mapping[k as never]),
        })),
        policy: {
          duplicate: ctx.project.policy.duplicate,
          invitations: ctx.project.policy.invitations,
          ratingScale: [ctx.project.policy.ratingMin, ctx.project.policy.ratingMax],
        },
        blockers: r.ready ? [] : r.warnings,
      },
    };
  },
};

/* ─────────────────────────── 2. compute_metric ─────────────────────────── */

const computeMetric: ToolDefinition = {
  name: "compute_metric",
  title: "计算单个指标",
  description:
    "按已确认口径计算一个指标，返回数值、分子、分母、公式与证据行。数值由确定性程序计算，工具不会估算。",
  inputSchema: {
    type: "object",
    properties: {
      metric: { type: "string", enum: METRIC_KEYS },
    },
    required: ["metric"],
    additionalProperties: false,
  },
  needsResult: true,
  run(input, ctx) {
    const key = input.metric as MetricKey;
    if (!METRIC_KEYS.includes(key))
      return { ok: false, error: "不支持的指标：" + String(input.metric) };
    const blocked = unavailable(ctx);
    if (blocked) return { ok: false, error: blocked };
    const metric = result(ctx).metrics[key];
    return {
      ok: true,
      data: {
        key: metric.key,
        label: metric.label,
        value: metric.value,
        display: formatValue(metric.value) + metric.unit,
        unit: metric.unit,
        formula: metric.formula,
        numerator: metric.numerator,
        denominator: metric.denominator,
        note: metric.note,
        evidence: asRefPreview(metric.evidence),
        evidenceCount: metric.evidence.length,
        denominatorCount: metric.denominatorEvidence.length,
      },
    };
  },
};

/* ───────────────────────────── 3. group_by ───────────────────────────── */

const groupBy: ToolDefinition = {
  name: "group_by",
  title: "分组统计",
  description:
    "按报名渠道或年级分组执行一项统计，返回每组数值、分子、分母与证据行。分组只包含能匹配到报名记录的人群。",
  inputSchema: {
    type: "object",
    properties: {
      metric: { type: "string", enum: PLAN_METRICS },
      groupBy: { type: "string", enum: ["channel", "grade", "none"] },
      order: { type: "string", enum: ["desc", "asc"] },
      title: { type: "string" },
    },
    required: ["metric", "groupBy", "order", "title"],
    additionalProperties: false,
  },
  needsResult: true,
  run(input, ctx) {
    const blocked = unavailable(ctx);
    if (blocked) return { ok: false, error: blocked };
    const parsed = planSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "统计参数不合法。请检查指标与分组取值。" };
    try {
      const rows = executePlan(parsed.data, result(ctx), ctx.project);
      return {
        ok: true,
        data: {
          plan: parsed.data,
          rows: rows.map((row) => ({
            name: row.name,
            value: row.value,
            display: formatValue(row.value),
            numerator: row.numerator,
            denominator: row.denominator,
            evidence: asRefPreview(row.evidence, 3),
            evidenceCount: row.evidence.length,
          })),
          groupCount: rows.length,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "分组统计失败。" };
    }
  },
};

/* ───────────────────────────── 4. search_policy ───────────────────────────── */

const searchPolicy: ToolDefinition = {
  name: "search_policy",
  title: "检索口径知识库",
  description:
    "在口径知识库中检索与问题相关的口径条目，返回条目编号、正文摘要与相关度。生成分析计划前应先检索，并只依据检索到的口径作答。",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      k: { type: "integer", minimum: 1, maximum: 8 },
    },
    required: ["query"],
    additionalProperties: false,
  },
  needsResult: false,
  run(input) {
    const query = String(input.query ?? "").trim();
    if (!query) return { ok: false, error: "检索词不能为空。" };
    const k = Math.min(Math.max(Number(input.k) || 4, 1), 8);
    const hits: KbHit[] = searchKb(query, { k });
    return {
      ok: true,
      data: {
        query,
        hits: hits.map(toCitation),
        brief: kbBrief(hits),
        empty: hits.length === 0,
      },
    };
  },
};

/* ───────────────────────────── 5. preflight ───────────────────────────── */

const preflight: ToolDefinition = {
  name: "preflight",
  title: "执行前自检",
  description:
    "在执行统计前检查该计划能否成立：分母是否为零、是否存在匿名反馈、问卷发放范围是否已确认、分组基数是否异常。返回阻塞项与提醒，不抛异常。",
  inputSchema: {
    type: "object",
    properties: {
      metric: { type: "string", enum: PLAN_METRICS },
      groupBy: { type: "string", enum: ["channel", "grade", "none"] },
      order: { type: "string", enum: ["desc", "asc"] },
      title: { type: "string" },
    },
    required: ["metric", "groupBy", "order", "title"],
    additionalProperties: false,
  },
  needsResult: true,
  run(input, ctx) {
    const parsed = planSchema.safeParse(input);
    if (!parsed.success)
      return {
        ok: true,
        data: { pass: false, blockers: ["统计参数不合法：指标或分组取值超出支持范围。"], warnings: [] },
      };
    const plan: Plan = parsed.data;
    const blocked = unavailable(ctx);
    const r = result(ctx);
    const blockers: string[] = blocked ? [blocked] : [];
    const warnings: string[] = [];
    if (!blocked) {
      try {
        const rows = executePlan(plan, r, ctx.project);
        const metric = r.metrics[plan.metric];
        if (metric.value === null)
          blockers.push(metric.note || "该指标当前无法计算（分母可能为零）。");
        if (plan.groupBy !== "none") {
          if (!rows.length) blockers.push("该分组没有任何可统计的组。");
          const empty = rows.filter((row) => row.denominator === 0);
          if (empty.length)
            warnings.push(
              `${empty.length} 个分组的分母为 0，结果将显示为无法计算：${empty
                .slice(0, 3)
                .map((row) => row.name)
                .join("、")}`,
            );
          const tiny = rows.filter((row) => row.denominator > 0 && row.denominator < 5);
          if (tiny.length)
            warnings.push(
              `${tiny.length} 个分组的样本量小于 5，结论只能描述该组实际发生的情况：${tiny
                .slice(0, 3)
                .map((row) => row.name)
                .join("、")}`,
            );
        }
      } catch (e) {
        blockers.push(e instanceof Error ? e.message : "执行校验失败。");
      }
    }
    return {
      ok: true,
      data: { pass: blockers.length === 0, plan, blockers, warnings },
    };
  },
};

/* ───────────────────────────── 6. check_claim ───────────────────────────── */

const checkClaimTool: ToolDefinition = {
  name: "check_claim",
  title: "核验一条结论",
  description:
    "核验一条结论：数字是否与当前计算结果一致、引用的证据行是否仍然存在、该结论是否已随版本变更失效。返回逐项检查结果。",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
      metric: { type: "string", enum: METRIC_KEYS },
      value: { type: "number" },
    },
    required: ["text", "metric"],
    additionalProperties: false,
  },
  needsResult: true,
  run(input, ctx) {
    if (!ctx.snapshot)
      return { ok: false, error: "核验结论需要一个已确认的版本快照。" };
    const metric = input.metric as MetricKey;
    if (!METRIC_KEYS.includes(metric))
      return { ok: false, error: "不支持的指标：" + String(input.metric) };
    const claim: Claim = {
      id: "probe",
      text: String(input.text ?? ""),
      snapshotId: ctx.snapshot.id,
      metric,
      value: typeof input.value === "number" ? input.value : null,
      evidence: ctx.snapshot.result.metrics[metric].evidence,
    };
    const checked = checkClaim(claim, ctx.snapshot, ctx.snapshot);
    return { ok: true, data: checked };
  },
};

export const TOOLS: ToolDefinition[] = [
  listFields,
  searchPolicy,
  preflight,
  computeMetric,
  groupBy,
  checkClaimTool,
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** OpenAI `tools` 参数格式（function calling 用）。 */
export function toolsForModel() {
  return TOOLS.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

/** MCP `tools/list` 响应格式。 */
export function toolsForMcp() {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }));
}

/** MCP `tools/call` 执行入口。 */
export function callTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): ToolOutcome {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return { ok: false, error: `未知工具：${name}` };
  try {
    return tool.run(input ?? {}, ctx);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "工具执行失败。" };
  }
}
