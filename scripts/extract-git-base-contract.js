#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const DIST_DIR = process.env.DIST_DIR || 'dist';
const MAIN_FILE = process.env.API_MAIN_FILE || process.argv[2] || 'api.raml';
const OUTPUT = process.env.API_CONTRACT_GIT_BASE || path.join(DIST_DIR, 'api-contract-git-base.json');
const coreRoot = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    timeout: options.timeout || 120000,
    cwd: options.cwd || process.cwd(),
    env: process.env
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error };
}

function writeSkipped(reason, details = {}) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify({
    status: 'SKIPPED',
    reason,
    details,
    generatedAt: new Date().toISOString(),
    endpoints: [],
    types: {},
    securitySchemes: [],
    traits: []
  }, null, 2), 'utf8');
  console.warn(`⚠️ Git Diff Guard SKIPPED: ${reason}`);
}

function normalizeBranchRef(value) {
  if (!value) return null;
  return String(value).replace(/^refs\/heads\//, '').trim();
}

function candidateRefs() {
  const refs = [];
  const githubBase = normalizeBranchRef(process.env.GITHUB_BASE_REF);
  if (githubBase) {
    refs.push(`origin/${githubBase}`);
    refs.push(githubBase);
  }

  const azureTarget = normalizeBranchRef(process.env.SYSTEM_PULLREQUEST_TARGETBRANCH);
  if (azureTarget) {
    refs.push(`origin/${azureTarget}`);
    refs.push(azureTarget);
  }

  refs.push('HEAD~1');
  refs.push('HEAD^');
  return [...new Set(refs.filter(Boolean))];
}

function refExists(ref) {
  const result = run('git', ['rev-parse', '--verify', `${ref}^{commit}`]);
  return result.status === 0;
}

function ensureRemoteBaseFetched() {
  const base = normalizeBranchRef(process.env.GITHUB_BASE_REF) || normalizeBranchRef(process.env.SYSTEM_PULLREQUEST_TARGETBRANCH);
  if (!base) return;
  // Best effort only. Works in GitHub/Azure Linux runners. Failure should not block stable baseline guard.
  run('git', ['fetch', '--no-tags', 'origin', `${base}:refs/remotes/origin/${base}`], { timeout: 180000 });
}

function extractUsingRef(ref) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rfg-git-base-'));
  const add = run('git', ['worktree', 'add', '--detach', tmp, ref], { timeout: 180000 });
  if (add.status !== 0) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    throw new Error(add.stderr || `git worktree add failed for ${ref}`);
  }

  try {
    const ramlPath = path.join(tmp, MAIN_FILE);
    if (!fs.existsSync(ramlPath)) throw new Error(`Arquivo ${MAIN_FILE} não existe em ${ref}`);

    fs.mkdirSync(DIST_DIR, { recursive: true });
    const extractor = path.join(coreRoot, 'scripts', 'extract-raml-contract.js');
    const result = spawnSync(process.execPath, [extractor, ramlPath, OUTPUT], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: { ...process.env, API_MAIN_FILE: ramlPath },
      shell: false,
      timeout: 180000
    });
    if (result.status !== 0) throw new Error(`Falha ao extrair contrato do ref ${ref}`);

    const data = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
    data.status = 'OK';
    data.source = `git:${ref}`;
    data.baseRef = ref;
    data.sourceFile = `${ref}:${MAIN_FILE}`;
    fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 2), 'utf8');
    console.log(`✅ Git base contract extraído de ${ref}: ${OUTPUT}`);
    return true;
  } finally {
    run('git', ['worktree', 'remove', '--force', tmp], { timeout: 120000 });
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

function main() {
  console.log('================================================================================');
  console.log('GIT DIFF GUARD — EXTRACT BASE CONTRACT');
  console.log('================================================================================');

  const insideGit = run('git', ['rev-parse', '--is-inside-work-tree']);
  if (insideGit.status !== 0 || insideGit.stdout.trim() !== 'true') {
    writeSkipped('Não é um repositório Git.');
    return;
  }

  ensureRemoteBaseFetched();

  const refs = candidateRefs();
  for (const ref of refs) {
    if (!refExists(ref)) continue;
    try {
      if (extractUsingRef(ref)) return;
    } catch (error) {
      console.warn(`⚠️ Não foi possível usar ${ref}: ${error.message}`);
    }
  }

  writeSkipped('Nenhum ref base encontrado para comparar.', { tried: refs });
}

main();
