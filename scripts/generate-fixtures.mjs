// Synthetic data only. No real student records are included.
import { mkdir, writeFile } from "node:fs/promises";
import Papa from "papaparse";
const folder = new URL("../fixtures/", import.meta.url);
await mkdir(folder, { recursive: true });
const id = (i) => "S" + String(i).padStart(4, "0");
const channels = ["社团推送", "班级群", "校园海报", "朋友推荐"];
const grades = ["大一", "大二", "大三"];
const registration = Array.from({ length: 300 }, (_, i) => ({
  学号: id(i + 1),
  报名渠道: channels[Math.floor(i / 75)],
  年级: grades[i % 3],
}));
const arrived = [
  ...Array.from({ length: 65 }, (_, i) => i + 1),
  ...Array.from({ length: 50 }, (_, i) => i + 76),
  ...Array.from({ length: 40 }, (_, i) => i + 151),
  ...Array.from({ length: 25 }, (_, i) => i + 226),
];
const attendance = [
  ...arrived,
  ...Array.from({ length: 30 }, (_, i) => i + 301),
  ...arrived.slice(0, 30),
].map((i, n) => ({
  学生编号: id(i),
  签到时间: `2026-10-20 14:${String(n % 60).padStart(2, "0")}`,
}));
const feedback = arrived
  .slice(0, 90)
  .map((i, n) => ({ 学号: id(i), 满意度: String(n % 5 === 0 ? 5 : 4) }));
const clean = attendance.filter(
  (r, index, all) =>
    all.findIndex((other) => other["学生编号"] === r["学生编号"]) === index,
);
const corrected = attendance.filter((r) => r["学生编号"] !== "S0001");
const files = {
  "registration.csv": registration,
  "attendance.csv": attendance,
  "feedback.csv": feedback,
  "attendance-clean.csv": clean,
  "attendance-corrected.csv": corrected,
};
for (const [name, rows] of Object.entries(files))
  await writeFile(
    new URL(name, folder),
    "\uFEFF" + Papa.unparse(rows, { escapeFormulae: true }),
    "utf8",
  );
await writeFile(
  new URL("expected.json", folder),
  JSON.stringify(
    {
      synthetic: true,
      policy: {
        duplicate: "first",
        invitations: "registeredAttendees",
        ratingMin: 1,
        ratingMax: 5,
      },
      original: {
        registered: 300,
        attendanceRecords: 240,
        attended: 210,
        registeredAttended: 180,
        attendanceRate: 60,
        duplicates: 30,
        walkIns: 30,
        feedbackRate: 50,
        satisfaction: 4.2,
      },
      clean: { duplicates: 0, attended: 210, attendanceRate: 60 },
      corrected: {
        attended: 209,
        registeredAttended: 179,
        duplicates: 29,
        attendanceRate: (179 / 300) * 100,
        feedbackRate: (89 / 179) * 100,
        satisfaction: 373 / 89,
      },
    },
    null,
    2,
  ),
);
console.log("Generated synthetic CSV fixtures and expected metrics.");
