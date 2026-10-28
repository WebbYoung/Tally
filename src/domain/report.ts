import { checkClaim, claimsFor, formatValue } from "./engine";
import type { AnalysisRecord, Ref, Snapshot } from "./types";
import { download } from "./files";
const escape = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function refsHtml(refs: Ref[]): string {
  const groups = new Map<string, { ref: Ref; rows: Set<number> }>();
  for (const ref of refs) {
    const key = JSON.stringify([ref.sourceId, ref.file, ref.sheet]);
    if (!groups.has(key)) groups.set(key, { ref, rows: new Set() });
    groups.get(key)!.rows.add(ref.row);
  }
  return (
    [...groups.values()]
      .map(({ ref, rows }) => {
        const sorted = [...rows].sort((a, b) => a - b);
        const ranges: string[] = [];
        for (let i = 0; i < sorted.length; i++) {
          const first = sorted[i];
          let last = first;
          while (sorted[i + 1] === last + 1) last = sorted[++i];
          ranges.push(first === last ? String(first) : `${first}–${last}`);
        }
        return `${escape(ref.file)} / ${escape(ref.sheet)} [${escape(ref.sourceId)}] 第 ${ranges.join("、")} 行（${sorted.length} 条）`;
      })
      .join("；") || "无"
  );
}
function policyHtml(snapshot: Snapshot) {
  const p = snapshot.project.policy;
  const invitations = {
    unknown: "未知，不计算反馈回收率",
    allAttendees: "全部有效到场者",
    registeredAttendees: "已报名且到场者",
    custom: "自定义受邀名单与有效到场者的交集",
  }[p.invitations];
  return `<h3>本版本统一口径卡</h3><ul><li>适用活动：${escape(snapshot.project.name)} / ${escape(snapshot.project.date)}，只统计当前活动导入文件。</li><li>人员匹配：可靠编号 NFKC 规范化后去首尾空白，保留前导零；不按姓名模糊匹配。</li><li>重复处理：同一文件按原始行序保留${p.duplicate === "first" ? "首条" : "末条"}；跨文件重叠须人工处理，不按时间戳排序。</li><li>反馈发放范围：${escape(invitations)}；自定义名单不公开人员编号，实际分母以证据引用为准。</li><li>满意度有效区间：${p.ratingMin}–${p.ratingMax}；空值、非数值、越界值均不计零分。</li><li>匿名反馈只计算总体记录均分，不计算人员回收率或分层；非匿名反馈仅统计有效到场者。</li><li>空分母或不可计算结果显示“—”；百分比和非整数显示一位小数，计算保留原始精度。</li><li>分层来自报名表，仅含可以关联报名的人员；总体到场人数包含未报名到场者。</li></ul>`;
}
function chartCell(
  value: number | null,
  unit: string,
  rows: AnalysisRecord["rows"],
) {
  const max = Math.max(0, ...rows.map((r) => r.value ?? 0));
  const width =
    value === null || max === 0 ? 0 : Math.max(0, (value / max) * 100);
  return `<strong>${formatValue(value)}${escape(unit)}</strong><div class="bar-track" aria-hidden="true"><div class="bar" style="width:${width}%"></div></div>`;
}
export function reportHtml(
  snapshot: Snapshot,
  analyses: AnalysisRecord[] = [],
): string {
  const metrics = Object.values(snapshot.result.metrics);
  const saved = analyses.filter((a) => a.snapshotId === snapshot.id);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>对表 · ${escape(snapshot.project.name)}</title><style>body{font:15px/1.7 system-ui,sans-serif;color:#18362f;max-width:1000px;margin:40px auto;padding:0 28px}h1{font-size:30px}h2{margin-top:36px}table{width:100%;border-collapse:collapse;margin:20px 0}td,th{border:1px solid #d7e1db;padding:10px;text-align:left}small{color:#55695e}code,p,td,li{overflow-wrap:anywhere}.bar-track{height:8px;background:#edf3ef;min-width:80px}.bar{height:8px;background:#176b57;print-color-adjust:exact;-webkit-print-color-adjust:exact}tr{break-inside:avoid}@page{size:A4;margin:15mm}.metric{break-inside:auto}button{padding:12px 20px;background:#176b57;color:white;border:0;border-radius:8px;cursor:pointer}@media print{button{display:none}body{margin:0;font-size:11px}h2,h3{break-after:avoid}thead{display:table-header}}</style><button onclick="window.print()">打印 / 保存为 PDF</button><p>对表 TALLY / 事实性活动复盘</p><h1>${escape(snapshot.project.name)}</h1><p>${escape(snapshot.project.date)} · ${escape(snapshot.label)} · ${escape(snapshot.createdAt)} ${snapshot.project.demo ? " · 虚构演示数据" : ""}</p><small>计算引擎 ${escape(snapshot.engineVersion)} · 口径版本 ${snapshot.project.policy.version} · 数据指纹 <code>${escape(snapshot.fingerprint)}</code></small><h2>01 核心指标</h2><table><thead><tr><th>指标</th><th>结果</th><th>口径</th></tr></thead><tbody>${metrics.map((m) => `<tr><td>${escape(m.label)}</td><td>${formatValue(m.value)}${escape(m.unit)}</td><td>${escape(m.formula)}<br><small>${escape(m.note)}</small></td></tr>`).join("")}</tbody></table>${policyHtml(snapshot)}<h2>02 数据质量与限制</h2><p>原始记录 ${snapshot.result.totalRows} 条。核对问题 ${snapshot.result.issues.length} 项。当前结果${snapshot.result.ready ? "已确认" : "仍为暂算，不可用于正式报告"}。</p><ul>${[...snapshot.result.warnings, "分组差异不构成因果证明；本报告不提供自动管理决策。", "源文件哈希用于验证文件身份，不替代原始材料或证明真实性。", "不导出人员标识列；活动名、文件名、提问标题、分组名称等自由文本仍需人工检查。请结合持有的原始文件与 JSON 索引复核。"].map((x) => `<li>${escape(x)}</li>`).join("")}</ul><h2>03 溯源附录</h2><p>连续行号以闭区间表示，例如 2–5 包含第 2、3、4、5 行；不省略任何命中行。来源标识对应下方源文件清单。完整逐行引用也保留在证据 JSON 中。</p>${metrics.map((m) => `<section class="metric"><h3>${escape(m.label)} · ${escape(m.key)}</h3><p>结论编号：${escape(snapshot.id + ":" + m.key)}<br>公式：${escape(m.formula)}<br>筛选条件：已确认映射、有效人员标识、已应用排除列表；${escape(m.note)}<br>分子：${formatValue(m.numerator)}；分母：${formatValue(m.denominator)}<br>口径：v${snapshot.project.policy.version} / 保留${snapshot.project.policy.duplicate === "first" ? "首条" : "末条"} / 反馈范围 ${escape(snapshot.project.policy.invitations)}<br>分子证据：${refsHtml(m.evidence)}<br>分母证据：${refsHtml(m.denominatorEvidence)}</p></section>`).join("")}<h2>04 源文件清单</h2>${snapshot.project.sources.map((s) => `<p>${escape(s.name)} / ${escape(s.sheet)} / ${s.rows.length} 行<br>来源标识：${escape(s.id)}<br><code>SHA-256 ${escape(s.hash)}</code><br>字段映射：${escape(JSON.stringify(s.mapping))}</p>`).join("")}<p>已排除原始记录引用：${escape(snapshot.project.policy.excludedRefs.join(", ") || "无")}</p><h2>05 已保存的分析与证据</h2>${saved.length ? saved.map((a) => `<section><h3>${escape(a.plan.title)}</h3><p>分析编号 ${escape(a.id)} · ${escape(a.createdAt)}<br>参数：${escape(JSON.stringify(a.plan))}<br>公式：${escape(snapshot.result.metrics[a.plan.metric].formula)}<br>筛选：确认版本的有效记录；${a.plan.groupBy === "none" ? "总体范围" : "按报名表属性分层，仅含能够关联到报名表的人员"}；口径 v${snapshot.project.policy.version}</p><table><tr><th>分组</th><th>结果</th><th>分子 / 分母</th></tr>${a.rows.map((r) => `<tr><td>${escape(r.name)}</td><td>${chartCell(r.value, snapshot.result.metrics[a.plan.metric].unit, a.rows)}</td><td>${r.numerator} / ${r.denominator}</td></tr>`).join("")}</table>${a.rows.map((r) => `<p>${escape(r.name)}<br>分子证据：${refsHtml(r.evidence)}<br>分母证据：${refsHtml(r.denominatorEvidence)}</p>`).join("")}</section>`).join("") : "<p>此版本尚未保存分析。请在确认版本上执行分析后重新导出。</p>"}<h2>06 结论检查</h2><p>规则检查，仅核对固定模板中的数字与引用，不判断任意文本事实或因果。下列状态仅针对本版本。</p>${claimsFor(
    snapshot,
  )
    .map((c) => {
      const check = checkClaim(c, snapshot, snapshot);
      return `<p>${escape(c.text)} 数字：${check.numeric ? "一致" : "不一致"}；引用：${check.refsValid ? "完整" : "无效"}。</p>`;
    })
    .join("")}</html>`;
}
export function exportReport(
  snapshot: Snapshot,
  analyses: AnalysisRecord[] = [],
) {
  download(
    `${snapshot.project.name}-${snapshot.label}-报告.html`,
    reportHtml(snapshot, analyses),
    "text/html;charset=utf-8",
  );
}
export function exportEvidence(
  snapshot: Snapshot,
  analyses: AnalysisRecord[] = [],
) {
  download(
    `${snapshot.project.name}-${snapshot.label}-证据索引.json`,
    JSON.stringify(
      {
        version: snapshot.id,
        createdAt: snapshot.createdAt,
        fingerprint: snapshot.fingerprint,
        engineVersion: snapshot.engineVersion,
        policy: { ...snapshot.project.policy, invitedIds: undefined },
        sources: snapshot.project.sources.map(
          ({ id, name, sheet, hash, mapping }) => ({
            id,
            name,
            sheet,
            hash,
            mapping,
          }),
        ),
        metrics: snapshot.result.metrics,
        claims: claimsFor(snapshot),
        analyses: analyses.filter((a) => a.snapshotId === snapshot.id),
      },
      null,
      2,
    ),
  );
}
