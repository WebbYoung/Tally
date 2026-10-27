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
const refsHtml = (refs: Ref[]) =>
  refs
    .map((r) => `${escape(r.file)} / ${escape(r.sheet)} 第 ${r.row} 行`)
    .join("；") || "无";
export function reportHtml(
  snapshot: Snapshot,
  analyses: AnalysisRecord[] = [],
): string {
  const metrics = Object.values(snapshot.result.metrics);
  const saved = analyses.filter((a) => a.snapshotId === snapshot.id);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>对表 · ${escape(snapshot.project.name)}</title><style>body{font:15px/1.7 system-ui,sans-serif;color:#18362f;max-width:1000px;margin:40px auto;padding:0 28px}h1{font-size:30px}h2{margin-top:36px}table{width:100%;border-collapse:collapse;margin:20px 0}td,th{border:1px solid #d7e1db;padding:10px;text-align:left}small{color:#55695e}code,p{overflow-wrap:anywhere}.metric{break-inside:auto}button{padding:12px 20px;background:#176b57;color:white;border:0;border-radius:8px;cursor:pointer}@media print{button{display:none}body{margin:0;font-size:11px}h2,h3{break-after:avoid}thead{display:table-header}}</style><button onclick="window.print()">打印 / 保存为 PDF</button><p>对表 TALLY / 事实性活动复盘</p><h1>${escape(snapshot.project.name)}</h1><p>${escape(snapshot.project.date)} · ${escape(snapshot.label)} · ${escape(snapshot.createdAt)} ${snapshot.project.demo ? " · 虚构演示数据" : ""}</p><small>计算引擎 ${escape(snapshot.engineVersion)} · 口径版本 ${snapshot.project.policy.version} · 数据指纹 <code>${escape(snapshot.fingerprint)}</code></small><h2>01 核心指标</h2><table><thead><tr><th>指标</th><th>结果</th><th>口径</th></tr></thead><tbody>${metrics.map((m) => `<tr><td>${escape(m.label)}</td><td>${formatValue(m.value)}${escape(m.unit)}</td><td>${escape(m.formula)}<br><small>${escape(m.note)}</small></td></tr>`).join("")}</tbody></table><h2>02 数据质量与限制</h2><p>原始记录 ${snapshot.result.totalRows} 条。核对问题 ${snapshot.result.issues.length} 项。当前结果${snapshot.result.ready ? "已确认" : "仍为暂算，不可用于正式报告"}。</p><ul>${[...snapshot.result.warnings, "分组差异不构成因果证明；本报告不提供自动管理决策。", "源文件哈希用于验证文件身份，不替代原始材料或证明真实性。", "不导出人员标识列；活动名、文件名、提问标题、分组名称等自由文本仍需人工检查。请结合持有的原始文件与 JSON 索引复核。"].map((x) => `<li>${escape(x)}</li>`).join("")}</ul><h2>03 溯源附录</h2>${metrics.map((m) => `<section class="metric"><h3>${escape(m.label)} · ${escape(m.key)}</h3><p>结论编号：${escape(snapshot.id + ":" + m.key)}<br>公式：${escape(m.formula)}<br>筛选条件：已确认映射、有效人员标识、已应用排除列表；${escape(m.note)}<br>分子：${formatValue(m.numerator)}；分母：${formatValue(m.denominator)}<br>口径：v${snapshot.project.policy.version} / 保留${snapshot.project.policy.duplicate === "first" ? "首条" : "末条"} / 反馈范围 ${escape(snapshot.project.policy.invitations)}<br>分子证据：${refsHtml(m.evidence)}<br>分母证据：${refsHtml(m.denominatorEvidence)}</p></section>`).join("")}<h2>04 源文件清单</h2>${snapshot.project.sources.map((s) => `<p>${escape(s.name)} / ${escape(s.sheet)} / ${s.rows.length} 行<br><code>SHA-256 ${escape(s.hash)}</code><br>字段映射：${escape(JSON.stringify(s.mapping))}</p>`).join("")}<p>已排除原始记录引用：${escape(snapshot.project.policy.excludedRefs.join(", ") || "无")}</p><h2>05 已保存的分析与证据</h2>${saved.length ? saved.map((a) => `<section><h3>${escape(a.plan.title)}</h3><p>分析编号 ${escape(a.id)} · ${escape(a.createdAt)}<br>参数：${escape(JSON.stringify(a.plan))}<br>公式：${escape(snapshot.result.metrics[a.plan.metric].formula)}<br>筛选：确认版本的有效记录；${a.plan.groupBy === "none" ? "总体范围" : "按报名表属性分层，仅含能够关联到报名表的人员"}；口径 v${snapshot.project.policy.version}</p><table><tr><th>分组</th><th>结果</th><th>分子 / 分母</th></tr>${a.rows.map((r) => `<tr><td>${escape(r.name)}</td><td>${formatValue(r.value)}${escape(snapshot.result.metrics[a.plan.metric].unit)}</td><td>${r.numerator} / ${r.denominator}</td></tr>`).join("")}</table>${a.rows.map((r) => `<p>${escape(r.name)}<br>分子证据：${refsHtml(r.evidence)}<br>分母证据：${refsHtml(r.denominatorEvidence)}</p>`).join("")}</section>`).join("") : "<p>此版本尚未保存分析。请在确认版本上执行分析后重新导出。</p>"}<h2>06 结论检查</h2><p>规则检查，仅核对固定模板中的数字与引用，不判断任意文本事实或因果。下列状态仅针对本版本。</p>${claimsFor(
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
          ({ name, sheet, hash, mapping }) => ({ name, sheet, hash, mapping }),
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
