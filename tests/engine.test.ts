import { describe,it,expect } from 'vitest';
import { demoProject } from '../src/domain/demo';
import { claimsFor,checkClaim,compareRows,executePlan,identityFingerprint,planSchema,reconcile } from '../src/domain/engine';
import { ENGINE_VERSION, type Project, type Snapshot } from '../src/domain/types';
import { reportHtml } from '../src/domain/report';

async function snapshot(p:Project,id='v1'):Promise<Snapshot>{return {id,label:id,createdAt:'2026-10-27T00:00:00Z',project:p,result:reconcile(p),fingerprint:await identityFingerprint(p),engineVersion:ENGINE_VERSION};}
describe('黄金数据与指标口径',()=>{
  it('300 报名、240 签到、210 到场、180 报名者到场、60% 到场率',async()=>{const r=reconcile(await demoProject());expect(r.ready).toBe(true);expect(r.metrics.registered.value).toBe(300);expect(r.metrics.attended.value).toBe(210);expect(r.metrics.attendanceRate.value).toBe(60);expect(r.metrics.attendanceRate.numerator).toBe(180);expect(r.metrics.duplicates.value).toBe(30);expect(r.metrics.walkIns.value).toBe(30);expect(r.metrics.feedbackRate.value).toBe(50);expect(r.metrics.satisfaction.value).toBe(4.2);});
  it('发放范围变更只按目标人群计算反馈回收率',async()=>{const p=await demoProject();p.policy.invitations='allAttendees';expect(reconcile(p).metrics.feedbackRate.value).toBeCloseTo(90/210*100);p.policy.invitations='custom';p.policy.invitedIds=['S0001','S0001','S0002','not-attended'];expect(reconcile(p).metrics.feedbackRate.denominator).toBe(2);expect(reconcile(p).metrics.feedbackRate.value).toBe(100);});
  it('未知反馈范围不输出回收率',async()=>{const p=await demoProject();p.policy.invitations='unknown';expect(reconcile(p).metrics.feedbackRate.value).toBeNull();});
  it('零分母显示不可计算',async()=>{const p=await demoProject();p.sources[0].rows=[];expect(reconcile(p).metrics.attendanceRate.value).toBeNull();});
  it('人员标识缺失不会被自动视作未报名到场者',async()=>{const p=await demoProject();p.sources[1].rows.push({rowNumber:999,values:{'学生编号':'','签到时间':'14:00'}});const r=reconcile(p);expect(r.ready).toBe(false);expect(r.metrics.walkIns.value).toBe(30);expect(r.issues.some(i=>i.kind==='missingId')).toBe(true);});
  it('缺失、非法、越界评分均不计为零分',async()=>{const p=await demoProject();p.sources[2].rows[0].values['满意度']='';p.sources[2].rows[1].values['满意度']='abc';p.sources[2].rows[2].values['满意度']='99';const r=reconcile(p);expect(r.metrics.satisfaction.denominator).toBe(87);expect(r.metrics.satisfaction.value).toBeCloseTo((378-5-4-4)/87);});
  it('匿名反馈只产生总体评分，不产生回收率或人员分层',async()=>{const p=await demoProject();delete p.sources[2].mapping.id;const r=reconcile(p);expect(r.metrics.feedbackRate.value).toBeNull();expect(r.metrics.satisfaction.value).toBe(4.2);expect(()=>executePlan({metric:'satisfaction',groupBy:'channel',order:'desc',title:'test'},r,p)).toThrow('匿名');});
  it('跨文件相同人员先拦截，不静默增加重复签到数',async()=>{const p=await demoProject();const extra=structuredClone(p.sources[1]);extra.id='another-file';extra.rows=extra.rows.slice(0,1);p.sources.push(extra);const r=reconcile(p);expect(r.ready).toBe(false);expect(r.issues.some(i=>i.kind==='overlap')).toBe(true);p.policy.excludedRefs.push('another-file:2');expect(reconcile(p).ready).toBe(true);expect(reconcile(p).metrics.attended.value).toBe(210);});
  it('反馈重复只保留按口径选定的一份',async()=>{const p=await demoProject();p.sources[2].rows.push({rowNumber:200,values:{'学号':'S0001','满意度':'1'}});expect(reconcile(p).metrics.satisfaction.value).toBe(4.2);p.policy.duplicate='last';expect(reconcile(p).metrics.satisfaction.value).toBeCloseTo((378-5+1)/90);});
  it('映射未确认时禁止正式分析',async()=>{const p=await demoProject();p.sources[0].confirmed=false;expect(()=>executePlan({metric:'registered',groupBy:'none',order:'desc',title:'人数'},reconcile(p),p)).toThrow('确认');});
});
describe('受约束的统计计划',()=>{
  it('渠道分层使用各自报名人数作分母',async()=>{const p=await demoProject();const rows=executePlan({metric:'attendanceRate',groupBy:'channel',order:'desc',title:'渠道'},reconcile(p),p);expect(rows.map(r=>r.numerator)).toEqual([65,50,40,25]);expect(rows.every(r=>r.denominator===75)).toBe(true);expect(rows[0].evidence).toHaveLength(65);});
  it('缺少分组字段给出明确提示',async()=>{const p=await demoProject();delete p.sources[0].mapping.channel;expect(()=>executePlan({metric:'attended',groupBy:'channel',order:'desc',title:'test'},reconcile(p),p)).toThrow('缺少报名渠道');});
  it('拒绝任意 SQL 与未知统计操作',()=>{expect(()=>planSchema.parse({metric:'sql',query:'drop table',groupBy:'none',order:'desc',title:'bad'})).toThrow();});
  it('零样本分组不生成百分比',async()=>{const p=await demoProject();p.policy.invitations='custom';p.policy.invitedIds=[];expect(executePlan({metric:'feedbackRate',groupBy:'channel',order:'desc',title:'反馈'},reconcile(p),p).every(r=>r.value===null)).toBe(true);});
});
describe('版本与真实故障检测',()=>{
  it('结论的数字与完整引用均可检查，故障注入真失败',async()=>{const s=await snapshot(await demoProject());const claim=claimsFor(s)[0];expect(checkClaim(claim,s,s)).toEqual({numeric:true,refsValid:true,stale:false,causalReview:false});const broken={...claim,value:999,evidence:[],text:'因为宣传导致增长'};expect(checkClaim(broken,s,s)).toEqual({numeric:false,refsValid:false,stale:false,causalReview:true});});
  it('新版本变更触发重核，旧版本的值仍是原结果',async()=>{const p=await demoProject();const a=await snapshot(structuredClone(p));p.sources[1].rows=p.sources[1].rows.filter(r=>r.values['学生编号']!=='S0001');p.sources[1].hash='new-content-hash';const b=await snapshot(p,'v2');expect(a.result.metrics.attendanceRate.value).toBe(60);expect(b.result.metrics.attendanceRate.value).toBeCloseTo(179/300*100);expect(checkClaim(claimsFor(a)[2],a,b).stale).toBe(true);});
  it('唯一标识可定位修改，重复标识不强行配对',async()=>{const a=await demoProject();const b=structuredClone(a);b.sources[0].rows[0].values['年级']='大四';b.sources[1].rows[0].values['签到时间']='15:00';const diff=compareRows(a,b);expect(diff.find(d=>d.key==='registration:S0001')?.kind).toBe('修改');expect(diff.find(d=>d.key==='attendance:S0001')?.kind).toBe('对应不确定');});
  it('报告转义输入，包含口径、哈希与行号且不泄露身份',async()=>{const p=await demoProject();p.name='<script>alert(1)</script>';const html=reportHtml(await snapshot(p));expect(html).not.toContain('<script>alert');expect(html).toContain('&lt;script&gt;');expect(html).toContain('SHA-256');expect(html).toContain('第 2 行');expect(html).not.toContain('S0001');});
});
