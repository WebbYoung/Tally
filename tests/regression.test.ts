import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { demoProject } from "../src/domain/demo";
import {
  claimsFor,
  checkClaim,
  executePlan,
  identityFingerprint,
  reconcile,
} from "../src/domain/engine";
import { readSpreadsheet } from "../src/domain/files";
import { reportHtml } from "../src/domain/report";
import {
  ENGINE_VERSION,
  type AnalysisRecord,
  type Snapshot,
} from "../src/domain/types";

describe("溯源回归与可复现材料", () => {
  it("文字数值篡改和行号篡改都不能通过检查", async () => {
    const p = await demoProject();
    const s: Snapshot = {
      id: "v1",
      label: "v1",
      createdAt: "2026-10-27",
      project: p,
      result: reconcile(p),
      fingerprint: await identityFingerprint(p),
      engineVersion: ENGINE_VERSION,
    };
    const claim = claimsFor(s)[0];
    expect(
      checkClaim({ ...claim, text: "有效报名人数为 999人。" }, s, s).numeric,
    ).toBe(false);
    const refs = structuredClone(claim.evidence);
    refs[0].row = 999;
    expect(checkClaim({ ...claim, evidence: refs }, s, s).refsValid).toBe(
      false,
    );
  });
  it("渠道分析引用签到行，并且报告只收录当前版本的分析", async () => {
    const p = await demoProject();
    const s: Snapshot = {
      id: "v1",
      label: "v1",
      createdAt: "2026-10-27",
      project: p,
      result: reconcile(p),
      fingerprint: await identityFingerprint(p),
      engineVersion: ENGINE_VERSION,
    };
    const plan = {
      metric: "attendanceRate",
      groupBy: "channel",
      order: "desc",
      title: "渠道问题",
    } as const;
    const rows = executePlan(plan, s.result, p);
    expect(rows[0].evidence.every((r) => r.sourceId === p.sources[1].id)).toBe(
      true,
    );
    expect(
      rows[0].denominatorEvidence.every((r) => r.sourceId === p.sources[0].id),
    ).toBe(true);
    const a: AnalysisRecord = {
      id: "a1",
      snapshotId: "v1",
      createdAt: s.createdAt,
      plan,
      rows,
    };
    const html = reportHtml(s, [
      a,
      {
        ...a,
        id: "a2",
        snapshotId: "v2",
        plan: { ...plan, title: "另一版本问题" },
      },
    ]);
    expect(html).toContain("渠道问题");
    expect(html).toContain("86.7");
    expect(html).not.toContain("另一版本问题");
    expect(html).toContain("结论检查");
  });
  it("仓库中的原始、清洗与修正 fixture 可复现期望指标", async () => {
    const p = await demoProject();
    const expected = JSON.parse(
      await readFile("fixtures/expected.json", "utf8"),
    );
    for (const [filename, expectations] of [
      ["attendance.csv", expected.original],
      ["attendance-clean.csv", expected.clean],
      ["attendance-corrected.csv", expected.corrected],
    ] as const) {
      const bytes = await readFile("fixtures/" + filename);
      const [s] = await readSpreadsheet(
        new File([bytes], filename),
        "attendance",
      );
      s.confirmed = true;
      p.sources[1] = s;
      const result = reconcile(p);
      for (const [key, value] of Object.entries(expectations)) {
        if (key === "attendanceRecords" || key === "registeredAttended")
          continue;
        expect(
          result.metrics[key as keyof typeof result.metrics].value,
        ).toBeCloseTo(value as number, 8);
      }
    }
  });
});
