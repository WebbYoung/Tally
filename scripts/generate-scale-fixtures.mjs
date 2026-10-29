import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Synthetic QA only. Outputs are ignored by Git and contain no real student data.
const directory = resolve(process.argv[2] || ".local/scale");
await mkdir(directory, { recursive: true });
const registration = ["学号,报名渠道,年级"];
const attendance = ["学生编号,签到时间"];
const feedback = ["学号,满意度"];
for (let i = 0; i < 20000; i++) {
  registration.push(`P${i},渠道${i % 10},大三`);
  attendance.push(`P${i % 10000},14:00`);
}
for (let i = 0; i < 10000; i++) feedback.push(`P${i},4`);
for (const [name, rows] of Object.entries({
  registration,
  attendance,
  feedback,
}))
  await writeFile(
    resolve(directory, `${name}.csv`),
    rows.join("\r\n") + "\r\n",
  );
console.log(`虚构规模数据已生成：${directory}`);
console.log(
  "全部到场者受邀口径：20000 报名 / 10000 到场 / 50% 到场率 / 10000 重复 / 0 未报名 / 100% 回收 / 均分 4。十个渠道均为 1000/2000=50%。",
);
