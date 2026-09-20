import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Executes existing pure helpers with synthetic inputs. No files or DB rows
// are read by the tested path resolver; no authentication state is changed.
const require = createRequire(import.meta.url);
function load(file, overrides = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', code)(
    id => id in overrides ? overrides[id] : require(id), module, module.exports,
  );
  return module.exports;
}
const storage = load('lib/files/local-storage.ts', {
  'server-only': {}, '@/lib/files/validation': {},
});
const bucketRoot = path.join(process.cwd(), 'uploads', 'asset-files');
const sibling = storage.resolveUploadPath('asset-files', '../asset-files-sibling/example.pdf');
const crossEntity = storage.resolveUploadPath('asset-files', '11111111-1111-4111-8111-111111111111/../22222222-2222-4222-8222-222222222222/example.pdf');
const permissions = load('lib/security/permissions.ts');
const findings = {
  siblingBucketEscapeAccepted: path.relative(bucketRoot, sibling).startsWith('..'),
  authorizedEntityFolderEscapeAccepted: path.relative(bucketRoot, crossEntity).startsWith('22222222-'),
  denyCostOverrideBypassedWhenProfileFlagTrue: permissions.canViewCosts({
    role: { slug: 'maintenance_data_entry' }, permissions: [], profile: { can_view_costs: true },
  }),
};
fs.writeFileSync('docs/quality-audit-20260913-security-probes.json', JSON.stringify(findings, null, 2));
console.log(JSON.stringify(findings, null, 2));
