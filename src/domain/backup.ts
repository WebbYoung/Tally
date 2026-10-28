import { z } from "zod";
import type { SavedState } from "./storage";
import { hashText } from "./engine";
import { download } from "./files";
import type { Ref, Snapshot } from "./types";
const text = z.string().max(10000),
  short = z.string().max(500),
  num = z.number().finite(),
  count = num.int().nonnegative();
const row = z.object({
  rowNumber: count.min(1),
  values: z.record(short, text),
});
const source = z.object({
  id: short,
  name: short,
  sheet: short,
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  role: z.enum(["registration", "attendance", "feedback"]),
  headers: z.array(short).max(100),
  rows: z.array(row).max(20000),
  mapping: z.partialRecord(
    z.enum(["id", "channel", "grade", "time", "rating"]),
    short.optional(),
  ),
  confirmed: z.boolean(),
  warnings: z.array(text),
});
const policy = z
  .object({
    version: count,
    duplicate: z.enum(["first", "last"]),
    invitations: z.enum([
      "unknown",
      "allAttendees",
      "registeredAttendees",
      "custom",
    ]),
    invitedIds: z.array(short).max(20000),
    ratingMin: num,
    ratingMax: num,
    excludedRefs: z.array(text).max(600000),
  })
  .refine((p) => p.ratingMin < p.ratingMax);
const project = z.object({
  name: short,
  date: short,
  demo: z.boolean(),
  sources: z.array(source).max(30),
  policy,
});
const ref = z.object({
    sourceId: short,
    file: short,
    sheet: short,
    row: count.min(1),
    key: text,
  }),
  refs = z.array(ref).max(600000);
const person = z.object({
  id: text,
  anonymous: z.boolean().optional(),
  channel: text,
  grade: text,
  time: text,
  rating: num.nullable(),
  ref,
});
const metric = z.object({
  key: z.enum([
    "registered",
    "attended",
    "attendanceRate",
    "duplicates",
    "walkIns",
    "feedbackRate",
    "satisfaction",
  ]),
  label: text,
  value: num.nullable(),
  unit: short,
  formula: text,
  numerator: num.nullable(),
  denominator: num.nullable(),
  evidence: refs,
  denominatorEvidence: refs,
  note: text,
});
const result = z.object({
  metrics: z.object({
    registered: metric,
    attended: metric,
    attendanceRate: metric,
    duplicates: metric,
    walkIns: metric,
    feedbackRate: metric,
    satisfaction: metric,
  }),
  issues: z.array(
    z.object({
      kind: z.enum([
        "missingId",
        "duplicateRegistration",
        "duplicateAttendance",
        "duplicateFeedback",
        "overlap",
        "walkIn",
        "unmatchedFeedback",
        "invalidRating",
      ]),
      message: text,
      refs,
    }),
  ),
  registered: z.array(person),
  attendees: z.array(person),
  registeredAttendees: z.array(person),
  feedback: z.array(person),
  eligibleFeedback: z.array(person),
  ready: z.boolean(),
  warnings: z.array(text),
  totalRows: count,
});
const snapshot = z.object({
  id: short,
  createdAt: short,
  label: short,
  project,
  result,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  engineVersion: short,
});
const plan = z.object({
  metric: z.enum([
    "registered",
    "attended",
    "attendanceRate",
    "feedbackRate",
    "satisfaction",
  ]),
  groupBy: z.enum(["none", "channel", "grade"]),
  order: z.enum(["asc", "desc"]),
  title: short,
});
const analysis = z.object({
  id: short,
  snapshotId: short,
  createdAt: short,
  plan,
  rows: z
    .array(
      z.object({
        name: text,
        value: num.nullable(),
        numerator: num,
        denominator: num,
        evidence: refs,
        denominatorEvidence: refs,
      }),
    )
    .max(200),
});
const stateSchema = z.object({
  project,
  snapshots: z.array(snapshot).max(100),
  activeId: short.nullable(),
  analyses: z.array(analysis).max(500).optional(),
});
export function validateStateShape(
  value: unknown,
): asserts value is SavedState {
  if (!stateSchema.safeParse(value).success)
    throw new Error(
      "工作空间格式无效或超过恢复限制（100 个版本、500 项分析），请保留文件并检查来源。",
    );
}
export async function serializeBackup(state: SavedState): Promise<string> {
  validateStateShape(state);
  const content = JSON.stringify({
    format: "tally-workspace",
    version: 1,
    createdAt: new Date().toISOString(),
    checksum: await hashText(JSON.stringify(state)),
    state,
  });
  if (new TextEncoder().encode(content).length > 100 * 1024 * 1024)
    throw new Error("备份超过 100 MB 上限，请先分别导出各版本报告与证据索引。");
  return content;
}
export async function parseBackup(content: string): Promise<SavedState> {
  if (new TextEncoder().encode(content).length > 100 * 1024 * 1024)
    throw new Error("备份超过 100 MB 恢复上限。");
  let envelope: unknown;
  try {
    envelope = JSON.parse(content);
  } catch {
    throw new Error("备份不是有效 JSON 文件。");
  }
  const outer = z
    .object({
      format: z.literal("tally-workspace"),
      version: z.literal(1),
      createdAt: short,
      checksum: z.string(),
      state: z.unknown(),
    })
    .safeParse(envelope);
  if (!outer.success)
    throw new Error("不是受支持的对表完整备份；证据索引不能代替工作空间备份。");
  const state = outer.data.state;
  validateStateShape(state);
  if ((await hashText(JSON.stringify(state))) !== outer.data.checksum)
    throw new Error("备份校验失败，文件内容可能损坏或被修改。");
  const ids = new Set(state.snapshots.map((s) => s.id));
  if (
    ids.size !== state.snapshots.length ||
    (state.activeId && !ids.has(state.activeId))
  )
    throw new Error("备份的版本标识不一致。");
  for (const s of state.snapshots) {
    if (
      (await hashText(
        JSON.stringify({ engine: s.engineVersion, project: s.project }),
      )) !== s.fingerprint
    )
      throw new Error(`版本 ${s.label} 的数据指纹不一致。`);
    const check = referenceChecker(s);
    for (const m of Object.values(s.result.metrics))
      [...m.evidence, ...m.denominatorEvidence].forEach(check);
  }
  for (const a of state.analyses ?? []) {
    const s = state.snapshots.find((s) => s.id === a.snapshotId);
    if (!s) throw new Error("分析引用了不存在的版本。");
    const check = referenceChecker(s);
    for (const r of a.rows)
      [...r.evidence, ...r.denominatorEvidence].forEach(check);
  }
  return state;
}
function referenceChecker(s: Snapshot) {
  const lookup = new Map(
    s.project.sources.map((source) => [
      source.id,
      { source, rows: new Set(source.rows.map((r) => r.rowNumber)) },
    ]),
  );
  return (r: Ref) => {
    const item = lookup.get(r.sourceId);
    if (
      !item ||
      !item.rows.has(r.row) ||
      item.source.name !== r.file ||
      item.source.sheet !== r.sheet ||
      r.key !== `${r.sourceId}:${r.row}`
    )
      throw new Error(`版本 ${s.label} 有无效证据引用。`);
  };
}
export async function exportBackup(state: SavedState) {
  download(
    `${state.project.name}-完整备份.tally.json`,
    await serializeBackup(state),
  );
}
