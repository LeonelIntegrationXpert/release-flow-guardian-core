#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const MANIFEST_PATH = process.env.RELEASE_MANIFEST || 'release/release-manifest.yml';
const DIST_DIR = 'dist';
const REPORT_PATH = path.join(DIST_DIR, 'release-flow-guardian-report.md');
const EXPECTED_APP = 'mule-tlf-com-test';

const checks = [];

function add(status, name, details = '') {
  checks.push({ status, name, details });
  const icon = status === 'OK' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
  console.log(`${icon} ${name}${details ? ` — ${details}` : ''}`);
}

function failIf(condition, name, details = '') {
  if (condition) add('BLOCK', name, details);
  else add('OK', name, details);
}

function readYaml(file) {
  return YAML.parse(fs.readFileSync(file, 'utf8'));
}

function currentBranch() {
  const azureFull = process.env.BUILD_SOURCEBRANCH || '';
  const githubRef = process.env.GITHUB_REF || '';
  return (
    process.env.GITHUB_HEAD_REF ||
    process.env.GITHUB_REF_NAME ||
    process.env.BUILD_SOURCEBRANCHNAME ||
    azureFull.replace(/^refs\/heads\//, '') ||
    githubRef.replace(/^refs\/heads\//, '') ||
    'local'
  );
}

function branchAllowed(branch) {
  if (branch === 'local') return true;
  return (
    branch === 'main' ||
    branch === 'master' ||
    branch === 'dev' ||
    branch === 'esteira01' ||
    branch === 'esteira02' ||
    branch === 'preprod' ||
    branch === 'prodlike' ||
    branch.startsWith('feature/') ||
    branch.startsWith('hotfix/') ||
    branch.startsWith('release/')
  );
}

function requiredFile(file) {
  failIf(!fs.existsSync(file), `Arquivo obrigatório: ${file}`);
}

function main() {
  console.log('================================================================================');
  console.log('RELEASE FLOW GUARDIAN — MANIFEST VALIDATION');
  console.log('================================================================================');

  fs.mkdirSync(DIST_DIR, { recursive: true });

  requiredFile('api.raml');
  requiredFile('README.md');
  requiredFile(MANIFEST_PATH);
  requiredFile('types/release-status-response-data-type.raml');
  requiredFile('examples/release-status-200-example.raml');
  requiredFile('traits/client-identification-trait.raml');
  requiredFile('securitySchemes/client-id-enforcement-security-scheme.raml');

  if (!fs.existsSync(MANIFEST_PATH)) {
    writeReport();
    process.exit(1);
  }

  const manifest = readYaml(MANIFEST_PATH);
  const release = manifest.release || {};
  const gates = manifest.gates || {};
  const evidence = manifest.evidence || {};
  const branch = currentBranch();

  console.log(`Branch detectada: ${branch}`);

  failIf(!/^RLM[0-9]{6}$/.test(release.id || ''), 'release.id no padrão RLMYYYYMM', release.id || 'vazio');
  failIf(release.application !== EXPECTED_APP, 'release.application esperado', `${release.application || 'vazio'} / esperado ${EXPECTED_APP}`);
  failIf(!release.owner, 'release.owner preenchido');
  failIf(!branchAllowed(branch), 'branch permitida pelo Release Flow', branch);

  failIf(gates.manifest_required !== true, 'gate manifest_required habilitado');
  failIf(gates.shd_validation_required !== true, 'gate shd_validation_required habilitado');
  failIf(gates.api_manager_policy_review_required !== true, 'gate api_manager_policy_review_required habilitado');
  failIf(gates.design_center_drift_check_required !== true, 'gate design_center_drift_check_required habilitado');
  failIf(gates.rollback_plan_required !== true, 'gate rollback_plan_required habilitado');

  failIf(evidence.shd_validated !== true, 'evidência SHD validada');
  failIf(evidence.api_manager_policy_review !== true, 'evidência API Manager policy review');
  failIf(evidence.rollback_plan !== true, 'evidência rollback plan');

  writeReport(release, branch);

  const blockers = checks.filter(c => c.status === 'BLOCK');
  if (blockers.length > 0) {
    console.error(`\n❌ Release bloqueada. Blockers: ${blockers.length}`);
    process.exit(1);
  }

  console.log(`\n✅ Release Flow Guardian OK. Relatório: ${REPORT_PATH}`);
}

function writeReport(release = {}, branch = currentBranch()) {
  const totalOk = checks.filter(c => c.status === 'OK').length;
  const totalWarn = checks.filter(c => c.status === 'WARN').length;
  const totalBlock = checks.filter(c => c.status === 'BLOCK').length;
  const status = totalBlock > 0 ? 'BLOCKED' : 'READY_FOR_REVIEW';

  const lines = [];
  lines.push('# Release Flow Guardian Report');
  lines.push('');
  lines.push(`- **Application:** ${release.application || EXPECTED_APP}`);
  lines.push(`- **Release:** ${release.id || 'N/A'}`);
  lines.push(`- **Owner:** ${release.owner || 'N/A'}`);
  lines.push(`- **Branch:** ${branch}`);
  lines.push(`- **Status:** ${status}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- OK: ${totalOk}`);
  lines.push(`- WARN: ${totalWarn}`);
  lines.push(`- BLOCK: ${totalBlock}`);
  lines.push('');
  lines.push('## Checks');
  lines.push('');
  lines.push('| Status | Check | Details |');
  lines.push('|---|---|---|');

  for (const c of checks) {
    const icon = c.status === 'OK' ? '✅ OK' : c.status === 'WARN' ? '⚠️ WARN' : '❌ BLOCK';
    lines.push(`| ${icon} | ${c.name} | ${c.details || ''} |`);
  }

  lines.push('');
  lines.push('## Next Action');
  lines.push('');
  lines.push(totalBlock > 0 ? 'Corrigir blockers antes da promoção.' : 'Contrato pronto para revisão/publicação controlada.');

  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');
}

main();
