import { DEFAULT_POLICY, type Project, type Role, type Source } from "./types";
import { hashText } from "./engine";
import Papa from "papaparse";
export async function demoProject(): Promise<Project> {
  const source = async (
    role: Role,
    name: string,
    rows: Record<string, string>[],
    mapping: Source["mapping"],
  ): Promise<Source> => {
    const hash = await hashText(
      "\uFEFF" + Papa.unparse(rows, { escapeFormulae: true }),
    );
    return {
      id: `${role}-${hash.slice(0, 12)}`,
      name,
      sheet: "数据",
      hash,
      role,
      headers: Object.keys(rows[0]),
      rows: rows.map((values, i) => ({ rowNumber: i + 2, values })),
      mapping,
      confirmed: true,
      warnings: [],
    };
  };
  const id = (i: number) => `S${String(i).padStart(4, "0")}`;
  const channels = ["社团推送", "班级群", "校园海报", "朋友推荐"];
  const grades = ["大一", "大二", "大三"];
  const registration = Array.from({ length: 300 }, (_, i) => ({
    学号: id(i + 1),
    报名渠道: channels[Math.floor(i / 75)],
    年级: grades[i % 3],
  }));
  const arrivedIds = [
    ...Array.from({ length: 65 }, (_, i) => i + 1),
    ...Array.from({ length: 50 }, (_, i) => i + 76),
    ...Array.from({ length: 40 }, (_, i) => i + 151),
    ...Array.from({ length: 25 }, (_, i) => i + 226),
  ];
  const attendance = [
    ...arrivedIds,
    ...Array.from({ length: 30 }, (_, i) => i + 301),
    ...arrivedIds.slice(0, 30),
  ].map((i, n) => ({
    学生编号: id(i),
    签到时间: `2026-10-20 14:${String(n % 60).padStart(2, "0")}`,
  }));
  const feedback = arrivedIds
    .slice(0, 90)
    .map((i, n) => ({ 学号: id(i), 满意度: String(n % 5 === 0 ? 5 : 4) }));
  return {
    name: "秋日技术分享会",
    date: "2026-10-20",
    demo: true,
    policy: {
      ...structuredClone(DEFAULT_POLICY),
      invitations: "registeredAttendees",
    },
    sources: await Promise.all([
      source("registration", "报名名单.csv", registration, {
        id: "学号",
        channel: "报名渠道",
        grade: "年级",
      }),
      source("attendance", "现场签到.csv", attendance, {
        id: "学生编号",
        time: "签到时间",
      }),
      source("feedback", "活动反馈.csv", feedback, {
        id: "学号",
        rating: "满意度",
      }),
    ]),
  };
}
