import { z } from "zod";
import {
  ENGINE_VERSION,
  type AnalysisRow,
  type Claim,
  type Issue,
  type Metric,
  type MetricKey,
  type Person,
  type Plan,
  type Project,
  type Ref,
  type Result,
  type Snapshot,
  type Source,
} from "./types";

export const normalizeId = (s: string) => s.normalize("NFKC").trim();
const refKey = (s: Source, row: number) => `${s.id}:${row}`;
export function hashText(text: string): Promise<string> {
  return crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(text))
    .then((b) =>
      [...new Uint8Array(b)]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join(""),
    );
}
export const identityFingerprint = (project: Project) =>
  hashText(JSON.stringify({ engine: ENGINE_VERSION, project }));

export function mappingError(source: Source): string | null {
  const fields = Object.values(source.mapping).filter((v): v is string =>
    Boolean(v),
  );
  if (fields.some((h) => !source.headers.includes(h)))
    return "映射引用了不存在的列。";
  if (new Set(fields).size !== fields.length)
    return "同一原始列不能同时映射为多个字段。";
  if (source.role !== "feedback" && !source.mapping.id)
    return "报名与签到表必须指定可靠的人员标识。";
  if (source.role === "feedback" && !source.mapping.rating)
    return "反馈表必须指定满意度评分列。";
  return null;
}

export function reconcile(project: Project): Result {
  const issues: Issue[] = [];
  const warnings: string[] = [];
  const byRole: Record<Source["role"], Person[]> = {
    registration: [],
    attendance: [],
    feedback: [],
  };
  const excluded = new Set(project.policy.excludedRefs);
  let anonymousFeedback = false;
  for (const source of project.sources) {
    for (const row of source.rows) {
      const ref: Ref = {
        sourceId: source.id,
        file: source.name,
        sheet: source.sheet,
        row: row.rowNumber,
        key: refKey(source, row.rowNumber),
      };
      if (excluded.has(ref.key)) continue;
      const get = (field: keyof Source["mapping"]) =>
        row.values[source.mapping[field] ?? ""]?.trim() ?? "";
      let id = normalizeId(get("id"));
      if (!id && source.role !== "feedback") {
        issues.push({
          kind: "missingId",
          message: "缺少人员标识；请排除此行或重新上传修正文件。",
          refs: [ref],
        });
        continue;
      }
      if (!id) {
        id = `anonymous:${ref.key}`;
        anonymousFeedback = true;
      }
      const ratingText = get("rating");
      const score = ratingText === "" ? NaN : Number(ratingText);
      const rating =
        Number.isFinite(score) &&
        score >= project.policy.ratingMin &&
        score <= project.policy.ratingMax
          ? score
          : null;
      if (source.role === "feedback" && ratingText !== "" && rating === null)
        issues.push({
          kind: "invalidRating",
          message: `评分不在 ${project.policy.ratingMin}—${project.policy.ratingMax} 范围内；该评分不计入均值。`,
          refs: [ref],
        });
      byRole[source.role].push({
        id,
        channel: get("channel") || "未填写",
        grade: get("grade") || "未填写",
        time: get("time"),
        rating,
        ref,
      });
    }
  }
  function unique(role: Source["role"]): Person[] {
    const grouped = new Map<string, Person[]>();
    byRole[role].forEach((p) => {
      const rows = grouped.get(p.id);
      if (rows) rows.push(p);
      else grouped.set(p.id, [p]);
    });
    return [...grouped.values()].map((rows) => {
      if (rows.length > 1) {
        const sources = new Set(rows.map((p) => p.ref.sourceId));
        const overlap = sources.size > 1;
        issues.push({
          kind: overlap
            ? "overlap"
            : role === "attendance"
              ? "duplicateAttendance"
              : role === "registration"
                ? "duplicateRegistration"
                : "duplicateFeedback",
          message: overlap
            ? "跨文件出现同一人员；可能为重复导出或多次记录，须确认排除记录后再保存。"
            : `同一人员有 ${rows.length} 条记录，按口径保留${project.policy.duplicate === "first" ? "首条" : "末条"}。顺序以文件原始行序为准。`,
          refs: rows.map((p) => p.ref),
        });
      }
      return project.policy.duplicate === "first"
        ? rows[0]
        : rows[rows.length - 1];
    });
  }
  const registered = unique("registration");
  const attendees = unique("attendance");
  const feedback = unique("feedback");
  const regMap = new Map(registered.map((p) => [p.id, p]));
  const attIds = new Set(attendees.map((p) => p.id));
  const registeredAttendees = attendees.filter((p) => regMap.has(p.id));
  const walkIns = attendees.filter((p) => !regMap.has(p.id));
  walkIns.forEach((p) =>
    issues.push({
      kind: "walkIn",
      message:
        "已确认标识未出现在有效报名集合中；计入总到场，不计入已报名到场率分子。",
      refs: [p.ref],
    }),
  );
  feedback
    .filter((p) => !attIds.has(p.id) && !p.id.startsWith("anonymous:"))
    .forEach((p) =>
      issues.push({
        kind: "unmatchedFeedback",
        message: "该反馈无法关联到有效到场人员，不计入到场人群的反馈统计。",
        refs: [p.ref],
      }),
    );
  const eligibleFeedback = feedback.filter((p) => attIds.has(p.id));
  const inviteIds = new Set(
    project.policy.invitedIds.map(normalizeId).filter(Boolean),
  );
  const invited =
    project.policy.invitations === "allAttendees"
      ? attendees
      : project.policy.invitations === "registeredAttendees"
        ? registeredAttendees
        : project.policy.invitations === "custom"
          ? attendees.filter((p) => inviteIds.has(p.id))
          : [];
  const invitedSet = new Set(invited.map((p) => p.id));
  const responded = eligibleFeedback.filter((p) => invitedSet.has(p.id));
  const scoreRows = (anonymousFeedback ? feedback : eligibleFeedback).filter(
    (p) => p.rating !== null,
  );
  const scoreSum = scoreRows.reduce((n, p) => n + p.rating!, 0);
  const dupRefs = issues
    .filter((i) => i.kind === "duplicateAttendance")
    .flatMap((i) =>
      project.policy.duplicate === "first"
        ? i.refs.slice(1)
        : i.refs.slice(0, -1),
    );
  const refs = (ps: Person[]) => ps.map((p) => p.ref);
  const m = (
    key: MetricKey,
    label: string,
    value: number | null,
    unit: string,
    formula: string,
    evidence: Ref[],
    denominatorEvidence: Ref[] = [],
    numerator: number | null = value,
    denominator: number | null = null,
    note = "",
  ): Metric => ({
    key,
    label,
    value,
    unit,
    formula,
    evidence,
    denominatorEvidence,
    numerator,
    denominator,
    note,
  });
  const ratio = (a: number, b: number) => (b === 0 ? null : (a / b) * 100);
  const hasFeedback = project.sources.some((s) => s.role === "feedback");
  const metrics: Result["metrics"] = {
    registered: m(
      "registered",
      "有效报名人数",
      registered.length,
      "人",
      "有效报名按人员标识去重计数",
      refs(registered),
    ),
    attended: m(
      "attended",
      "总到场人数",
      attendees.length,
      "人",
      "有效签到按人员标识去重计数（含未报名到场）",
      refs(attendees),
    ),
    attendanceRate: m(
      "attendanceRate",
      "已报名人员到场率",
      ratio(registeredAttendees.length, registered.length),
      "%",
      "已报名且到场人数 ÷ 有效报名人数 × 100%",
      refs(registeredAttendees),
      refs(registered),
      registeredAttendees.length,
      registered.length,
      "分子不包含未报名到场者；分母为零时不计算。",
    ),
    duplicates: m(
      "duplicates",
      "重复签到记录数",
      dupRefs.length,
      "条",
      "同文件、同场次的人员重复记录条数（不含首条/末条保留记录）",
      dupRefs,
      [],
      dupRefs.length,
      null,
      "重复文件在导入时拦截；跨文件同人记录必须先人工核对。",
    ),
    walkIns: m(
      "walkIns",
      "未报名到场人数",
      walkIns.length,
      "人",
      "有效到场人员集合 − 有效报名人员集合",
      refs(walkIns),
      refs(registered),
    ),
    feedbackRate: m(
      "feedbackRate",
      "反馈回收率",
      !hasFeedback ||
        anonymousFeedback ||
        project.policy.invitations === "unknown"
        ? null
        : ratio(responded.length, invited.length),
      "%",
      "受邀到场者中的有效反馈人数 ÷ 受邀到场人数 × 100%",
      refs(responded),
      refs(invited),
      responded.length,
      project.policy.invitations === "unknown" ? null : invited.length,
      !hasFeedback
        ? "未导入反馈表。"
        : anonymousFeedback
          ? "含匿名反馈，无法验证回收率；仅提供总体评分。"
          : project.policy.invitations === "unknown"
            ? "请先确认问卷实际发放范围。"
            : "统计范围仅为受邀的到场人群；邀请未到场者时，需另设问卷口径。",
    ),
    satisfaction: m(
      "satisfaction",
      anonymousFeedback ? "反馈总体平均评分" : "到场者平均满意度",
      scoreRows.length ? scoreSum / scoreRows.length : null,
      "分",
      "有效评分之和 ÷ 有效评分数量",
      refs(scoreRows),
      refs(scoreRows),
      scoreSum,
      scoreRows.length,
      `${project.policy.ratingMin}—${project.policy.ratingMax} 分量表；缺失与越界评分不计零分。${anonymousFeedback ? "存在匿名记录，按有效记录计算，无法验证一人一份或做人群分层。" : ""}`,
    ),
  };
  const hasRequired = ["registration", "attendance"].every((role) =>
    project.sources.some((s) => s.role === role),
  );
  if (!hasRequired) warnings.push("需导入报名表与签到表才能完成核对。");
  if (anonymousFeedback)
    warnings.push(
      "反馈含匿名记录，回收率与反馈分层分析不可用；总体评分不代表到场人群。",
    );
  if (issues.some((i) => i.kind === "missingId" || i.kind === "overlap"))
    warnings.push(
      "存在身份缺失或跨文件重叠，当前为暂算结果；请处理后保存版本。",
    );
  if (project.sources.some((s) => !s.confirmed))
    warnings.push("请确认所有表格的字段映射与处理口径。");
  const invalidMapping = project.sources.some((s) => Boolean(mappingError(s)));
  if (invalidMapping) warnings.push("字段映射不完整或重复，请重新确认映射。");
  return {
    metrics,
    issues,
    registered,
    attendees,
    registeredAttendees,
    feedback,
    eligibleFeedback,
    ready:
      hasRequired &&
      !invalidMapping &&
      !issues.some((i) => i.kind === "missingId" || i.kind === "overlap") &&
      project.sources.every((s) => s.confirmed),
    warnings,
    totalRows: project.sources.reduce((n, s) => n + s.rows.length, 0),
  };
}

export const planSchema = z
  .object({
    metric: z.enum([
      "attendanceRate",
      "registered",
      "attended",
      "feedbackRate",
      "satisfaction",
    ]),
    groupBy: z.enum(["channel", "grade", "none"]),
    order: z.enum(["desc", "asc"]),
    title: z.string().min(1).max(100),
  })
  .strict();

export function executePlan(
  input: Plan,
  result: Result,
  project: Project,
): AnalysisRow[] {
  const plan = planSchema.parse(input);
  if (!result.ready)
    throw new Error("请先确认字段与处理待核对记录，再执行分析。");
  if (plan.groupBy === "none") {
    const m = result.metrics[plan.metric];
    if (m.value === null)
      throw new Error(m.note || "缺少有效数据或分母为零，无法计算。");
    return [
      {
        name: m.label,
        value: m.value,
        numerator: m.numerator ?? 0,
        denominator: m.denominator ?? 0,
        evidence: m.evidence,
        denominatorEvidence: m.denominatorEvidence,
      },
    ];
  }
  if (
    !project.sources.some(
      (s) =>
        s.role === "registration" &&
        s.mapping[plan.groupBy as "channel" | "grade"],
    )
  )
    throw new Error(
      `缺少${plan.groupBy === "channel" ? "报名渠道" : "年级"}字段，请在报名表中补充并确认映射。`,
    );
  if (
    ["feedbackRate", "satisfaction"].includes(plan.metric) &&
    result.feedback.some((p) => p.id.startsWith("anonymous:"))
  )
    throw new Error(
      "反馈中存在匿名记录，无法可靠关联人员；请使用总体评分分析。",
    );
  if (
    plan.metric === "feedbackRate" &&
    project.policy.invitations === "unknown"
  )
    throw new Error("缺少问卷实际发放范围，请先确认口径。");
  if (
    ["feedbackRate", "satisfaction"].includes(plan.metric) &&
    !project.sources.some((s) => s.role === "feedback")
  )
    throw new Error("缺少反馈表，请导入后再分析。");
  const groupBy = plan.groupBy;
  const groups = new Map<string, Person[]>();
  for (const p of result.registered) {
    const bucket = groups.get(p[groupBy]);
    if (bucket) bucket.push(p);
    else groups.set(p[groupBy], [p]);
  }
  if (groups.size > 200)
    throw new Error("分组超过 200 类，请检查渠道或年级是否误映射到人员标识。");
  const attendanceById = new Map(result.attendees.map((p) => [p.id, p]));
  const feedbackById = new Map(result.eligibleFeedback.map((p) => [p.id, p]));
  const custom = new Set(project.policy.invitedIds.map(normalizeId));
  const data = [...groups].map(([name, regs]) => {
    const arrived = regs.flatMap((p) => {
      const a = attendanceById.get(p.id);
      return a ? [a] : [];
    });
    const invited = arrived.filter(
      (p) => project.policy.invitations !== "custom" || custom.has(p.id),
    );
    const invitedSet = new Set(invited.map((p) => p.id));
    const feedback = regs.flatMap((p) => {
      const f = feedbackById.get(p.id);
      return f ? [f] : [];
    });
    const replied = feedback.filter((p) => invitedSet.has(p.id));
    const scores = feedback.filter((p) => p.rating !== null);
    const source =
      plan.metric === "registered"
        ? regs
        : plan.metric === "attended" || plan.metric === "attendanceRate"
          ? arrived
          : plan.metric === "feedbackRate"
            ? replied
            : scores;
    const denominatorRows =
      plan.metric === "attendanceRate"
        ? regs
        : plan.metric === "feedbackRate"
          ? invited
          : plan.metric === "satisfaction"
            ? scores
            : [];
    const numerator =
      plan.metric === "satisfaction"
        ? scores.reduce((n, p) => n + p.rating!, 0)
        : source.length;
    const denominator = denominatorRows.length;
    const value = plan.metric.endsWith("Rate")
      ? denominator
        ? (numerator / denominator) * 100
        : null
      : plan.metric === "satisfaction"
        ? denominator
          ? numerator / denominator
          : null
        : numerator;
    return {
      name,
      value,
      numerator,
      denominator,
      evidence: source.map((p) => p.ref),
      denominatorEvidence: denominatorRows.map((p) => p.ref),
    };
  });
  return data.sort((a, b) =>
    a.value === null && b.value === null
      ? 0
      : a.value === null
        ? 1
        : b.value === null
          ? -1
          : (a.value - b.value) * (plan.order === "desc" ? -1 : 1),
  );
}

export function claimsFor(snapshot: Snapshot): Claim[] {
  return Object.values(snapshot.result.metrics)
    .filter((m) => m.value !== null)
    .map((m) => ({
      id: `${snapshot.id}:${m.key}`,
      snapshotId: snapshot.id,
      metric: m.key,
      value: m.value,
      text: `${m.label}为 ${formatValue(m.value)}${m.unit}。`,
      evidence: [...m.evidence, ...m.denominatorEvidence],
    }));
}
export function checkClaim(claim: Claim, origin: Snapshot, current: Snapshot) {
  const expected = origin.result.metrics[claim.metric];
  // Claims are rendered from a fixed template, not arbitrary model prose.
  const numeric =
    claim.value === expected.value &&
    claim.text ===
      `${expected.label}为 ${formatValue(expected.value)}${expected.unit}。`;
  const signature = (r: Ref) =>
    JSON.stringify([r.key, r.sourceId, r.file, r.sheet, r.row]);
  const allowed = new Set(
    [...expected.evidence, ...expected.denominatorEvidence].map(signature),
  );
  const cited = new Set(claim.evidence.map(signature));
  const refsValid =
    allowed.size === cited.size &&
    [...allowed].every((k) => cited.has(k)) &&
    claim.snapshotId === origin.id;
  const latest = current.result.metrics[claim.metric];
  const dependencyChanged =
    metricDependencyChanges(claim.metric, origin, current).length > 0;
  return {
    numeric,
    refsValid,
    stale: dependencyChanged,
    causalReview: /导致|因为|造成|引起|使得/.test(claim.text),
  };
}
export function metricDependencyChanges(
  key: MetricKey,
  before: Snapshot,
  after: Snapshot,
): string[] {
  const roles: Source["role"][] =
    key === "registered"
      ? ["registration"]
      : key === "attended" || key === "duplicates"
        ? ["attendance"]
        : key === "attendanceRate" || key === "walkIns"
          ? ["registration", "attendance"]
          : key === "satisfaction"
            ? ["attendance", "feedback"]
            : [
                "attendance",
                "feedback",
                ...(before.project.policy.invitations ===
                  "registeredAttendees" ||
                after.project.policy.invitations === "registeredAttendees"
                  ? ["registration" as const]
                  : []),
              ];
  const reasons: string[] = [];
  for (const role of roles) {
    const pick = (s: Snapshot) =>
      s.project.sources
        .filter((x) => x.role === role)
        .map((x) => ({
          hash: x.hash,
          sheet: x.sheet,
          mapping: x.mapping,
          confirmed: x.confirmed,
        }));
    if (JSON.stringify(pick(before)) !== JSON.stringify(pick(after)))
      reasons.push(
        { registration: "报名表", attendance: "签到表", feedback: "反馈表" }[
          role
        ] + "或字段映射变化",
      );
  }
  const policy = (s: Snapshot) => ({
    duplicate: s.project.policy.duplicate,
    excluded: s.project.policy.excludedRefs.filter((ref) =>
      s.project.sources.some(
        (source) =>
          roles.includes(source.role) && ref.startsWith(source.id + ":"),
      ),
    ),
    ...(key === "feedbackRate"
      ? {
          invitations: s.project.policy.invitations,
          invitedIds:
            s.project.policy.invitations === "custom"
              ? [
                  ...new Set(s.project.policy.invitedIds.map(normalizeId)),
                ].sort()
              : [],
        }
      : {}),
    ...(key === "satisfaction"
      ? {
          ratingMin: s.project.policy.ratingMin,
          ratingMax: s.project.policy.ratingMax,
        }
      : {}),
  });
  if (JSON.stringify(policy(before)) !== JSON.stringify(policy(after)))
    reasons.push("该指标的统计口径或排除记录变化");
  const metric = (s: Snapshot) => {
    const m = s.result.metrics[key];
    return {
      value: m.value,
      numerator: m.numerator,
      denominator: m.denominator,
      evidence: m.evidence,
      denominatorEvidence: m.denominatorEvidence,
    };
  };
  if (JSON.stringify(metric(before)) !== JSON.stringify(metric(after)))
    reasons.push("计算结果或证据引用变化");
  if (before.engineVersion !== after.engineVersion)
    reasons.push("计算引擎版本变化");
  return reasons;
}
export const formatValue = (n: number | null) =>
  n === null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1);
export function compareRows(before: Project, after: Project) {
  // Only unique stable identifiers are matched. Repeated/anonymous rows remain ambiguous.
  const entries = (p: Project) => {
    const map = new Map<
      string,
      {
        file: string;
        sheet: string;
        row: number;
        values: Record<string, string>;
      }[]
    >();
    p.sources.forEach((s) =>
      s.rows.forEach((row) => {
        const id = normalizeId(row.values[s.mapping.id ?? ""] ?? "");
        const key = id
          ? `${s.role}:${id}`
          : `anonymous:${s.id}:${row.rowNumber}`;
        map.set(key, [
          ...(map.get(key) ?? []),
          {
            file: s.name,
            sheet: s.sheet,
            row: row.rowNumber,
            values: row.values,
          },
        ]);
      }),
    );
    return map;
  };
  const a = entries(before),
    b = entries(after);
  return [...new Set([...a.keys(), ...b.keys()])].flatMap((key) => {
    const x = a.get(key),
      y = b.get(key);
    if (
      JSON.stringify(x?.map((r) => r.values)) ===
      JSON.stringify(y?.map((r) => r.values))
    )
      return [];
    return [
      {
        key,
        kind: !x
          ? "新增"
          : !y
            ? "移除"
            : x.length !== 1 || y.length !== 1 || key.startsWith("anonymous:")
              ? "对应不确定"
              : "修改",
        before: x?.length ?? 0,
        after: y?.length ?? 0,
        beforeRows: x ?? [],
        afterRows: y ?? [],
      },
    ];
  });
}
