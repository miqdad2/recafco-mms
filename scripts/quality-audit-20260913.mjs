import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { chromium } from '@playwright/test';
import ts from 'typescript';

// Read-only business-data audit. Login creates ordinary session/audit records.
// Local production instance only; never prints credentials or record contents.
const origin = 'http://127.0.0.1:3107';
const output = 'docs/quality-audit-20260913-results.json';
const result = { timestamp: new Date().toISOString(), machine: { cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, memoryGiB: Math.round(os.totalmem()/2**30) }, checks: {}, pages: [], load: [] };
const prisma = new PrismaClient();
const save = () => fs.writeFileSync(output, JSON.stringify(result, null, 2));
const helpers = fs.readFileSync('tests/e2e/helpers.ts', 'utf8');
function credentials(role) {
  const block = helpers.match(new RegExp(`export const ${role} = \\{([\\s\\S]*?)\\};`))?.[1];
  return { email: block?.match(/email:\s*"([^"]+)"/)?.[1], password: block?.match(/password:\s*"([^"]+)"/)?.[1] };
}
const require = createRequire(import.meta.url);
const mod = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync('lib/security/permissions.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(require,mod,mod.exports);
result.checks.deniedCostWithProfileFlag = mod.exports.canViewCosts({ role:{slug:'maintenance_data_entry'},permissions:[],profile:{can_view_costs:true} });
try {
  result.database = {};
  for (const table of ['profiles','work_orders','assets','worker_profiles','work_order_work_sessions','offline_inventory_movements','notifications','realtime_events']) {
    const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM public.${table}`);
    result.database[table] = rows[0].count;
  }
  result.database.flags = await prisma.app_settings.findMany({select:{inventory_check_enabled:true}});
  result.database.sessionIndexes = await prisma.$queryRawUnsafe("SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='work_order_work_sessions'");
  result.database.duplicateActiveAssignments = await prisma.$queryRawUnsafe("SELECT COUNT(*)::int AS count FROM (SELECT worker_assignment_id FROM work_order_work_sessions WHERE status='Active' GROUP BY worker_assignment_id HAVING COUNT(*)>1) q");
  save();
  const browser = await chromium.launch({headless:true});
  try {
    for (const role of ['DATA_ENTRY','MANAGER']) {
      const context = await browser.newContext({baseURL:origin});
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message.slice(0,180)));
      const creds = credentials(role);
      await page.goto('/login');
      await page.locator('input[name="email"]').fill(creds.email);
      await page.locator('input[name="password"]').fill(creds.password);
      await page.getByRole('button',{name:'Sign in',exact:true}).click();
      try { await page.waitForURL(/\/dashboard/,{timeout:20000}); }
      catch { result.checks[`${role}_login`] = {ok:false,path:new URL(page.url()).pathname}; save(); await context.close(); continue; }
      result.checks[`${role}_login`] = {ok:true};
      const cookies = (await context.cookies()).map(c=>`${c.name}=${c.value}`).join('; ');
      for (const route of ['/dashboard','/maintenance/work-orders','/maintenance/daily-activity','/admin/worker-profiles','/maintenance/work-orders/new','/reports/work-orders']) {
        const samples=[]; let bytes=0,status=0,leakedSalary=false,leakedRate=false;
        for(let i=0;i<3;i++) {
          const start=performance.now();
          const response=await fetch(origin+route,{headers:{cookie:cookies},redirect:'manual'});
          const body=await response.text();
          samples.push(Math.round(performance.now()-start)); status=response.status; bytes=Buffer.byteLength(body);
          const normalized=body.replaceAll('\\"','"');
          leakedSalary ||= /"(?:basic_salary|total_salary)":(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9])/.test(normalized);
          leakedRate ||= /"hourly_rate":(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9])/.test(normalized);
        }
        result.pages.push({role,route,status,bytes,samplesMs:samples,nonzeroSalaryInPayload:leakedSalary,nonzeroHourlyRateInPayload:leakedRate});
        console.log(JSON.stringify(result.pages.at(-1))); save();
      }
      if(role==='DATA_ENTRY') {
        await page.goto('/admin/worker-profiles');
        result.checks.hiddenRateColumn = await page.getByRole('columnheader',{name:'Hourly Rate (KWD)'}).count()===0;
      }
      for (const concurrency of [10,50,100]) {
        const routes=['/dashboard','/maintenance/work-orders','/maintenance/daily-activity'];
        const timings=[]; const statuses={}; let totalBytes=0; const start=performance.now();
        await Promise.all(Array.from({length:concurrency},async(_,i)=>{
          const t=performance.now();
          try { const r=await fetch(origin+routes[i%routes.length],{headers:{cookie:cookies},redirect:'manual',signal:AbortSignal.timeout(60000)}); const b=await r.arrayBuffer(); totalBytes+=b.byteLength; statuses[r.status]=(statuses[r.status]??0)+1; }
          catch { statuses.error=(statuses.error??0)+1; }
          timings.push(performance.now()-t);
        }));
        timings.sort((a,b)=>a-b); const elapsedMs=performance.now()-start;
        result.load.push({role,concurrency,requests:concurrency,elapsedMs:Math.round(elapsedMs),p50Ms:Math.round(timings[Math.ceil(timings.length*.5)-1]),p95Ms:Math.round(timings[Math.ceil(timings.length*.95)-1]),maxMs:Math.round(timings.at(-1)),requestsPerSecond:Math.round(concurrency/elapsedMs*1000*10)/10,statuses,totalBytes});
        console.log(JSON.stringify(result.load.at(-1))); save();
      }
      result.checks[`${role}_browserErrors`]=errors;
      await context.close();
    }
  } finally { await browser.close(); }
} catch(e) { result.failure=String(e.message).slice(0,500); console.log(result.failure); process.exitCode=1; }
finally { await prisma.$disconnect(); save(); }
