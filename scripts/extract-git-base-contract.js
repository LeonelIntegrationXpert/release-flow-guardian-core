#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const PROJECT_DIR = path.resolve(process.env.GUARDIAN_PROJECT_DIR || process.cwd());
const CORE_ROOT = path.resolve(process.env.GUARDIAN_CORE_ROOT || path.join(__dirname, '..'));
const CURRENT_RAML = process.env.API_MAIN_FILE || process.argv[2] || 'api.raml';
const OUTPUT_FILE = process.argv[3] || path.join('dist', 'api-contract-git-base.json');
const outputPath = path.isAbsolute(OUTPUT_FILE) ? OUTPUT_FILE : path.join(PROJECT_DIR, OUTPUT_FILE);
const distDir = path.dirname(outputPath);

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: PROJECT_DIR,
    encoding: 'utf8',
    shell: false,
    timeout: options.timeout || 120000,
    env: process.env
  });
}

function writeSkipped(reason, attemptedRefs = []) {
  fs.mkdirSync(distDir, { recursive: true });
  const payload = {
    status: 'SKIPPED',
    reason,
    attemptedRefs,
    source: 'git-base',
    generatedAt: new Date().toISOString(),
    endpoints: [],
    types: {},
    securitySchemes: [],
    traits: []
  };
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
  console.warn(`⚠️ Git Diff Guard SKIPPED: ${reason}`);
  console.warn(`📄 ${outputPath}`);
}

function candidateTrees() {
  const refs = [];
  if (process.env.GITHUB_BASE_REF) {
    refs.push(`origin/${process.env.GITHUB_BASE_REF}`);
    refs.push(process.env.GITHUB_BASE_REF);
  }
  if (process.env.SYSTEM_PULLREQUEST_TARGETBRANCH) {
    const target = process.env.SYSTEM_PULLREQUEST_TARGETBRANCH.replace(/^refs\/heads\//, '');
    refs.push(`origin/${target}`);
    refs.push(target);
  }
  refs.push('HEAD^');
  refs.push('HEAD~1');
  return [...new Set(refs)];
}

function main() {
  console.log('================================================================================');
  console.log('GIT BASE CONTRACT EXTRACTION');
  console.log('================================================================================');

  const gitCheck = run('git', ['rev-parse', '--is-inside-work-tree']);
  if (gitCheck.status !== 0) {
    writeSkipped('Projeto não está dentro de um repositório Git.');
    return;
  }

  const refs = candidateTrees();
  let selectedRef = null;
  let tempDir = null;

  for (const ref of refs) {
    const show = run('git', ['show', `${ref}:${CURRENT_RAML}`]);
    if (show.status !== 0 || !show.stdout.trim()) continue;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-git-base-tree-'));
    const archive = spawnSync('git', ['archive', '--format=tar', ref], {
      cwd: PROJECT_DIR,
      encoding: null,
      shell: false,
      timeout: 120000,
      env: process.env
    });

    if (archive.status !== 0 || !archive.stdout) continue;

    const tar = spawnSync('tar', ['-xf', '-', '-C', tempDir], {
      input: archive.stdout,
      encoding: null,
      shell: false,
      timeout: 120000
    });

    if (tar.status !== 0) continue;
    selectedRef = ref;
    break;
  }

  if (!selectedRef || !tempDir) {
    writeSkipped('Não foi possível encontrar api.raml na branch base ou commit anterior.', refs);
    return;
  }

  const tempRaml = path.join(tempDir, CURRENT_RAML);
  if (!fs.existsSync(tempRaml)) {
    writeSkipped(`Arquivo ${CURRENT_RAML} não encontrado no snapshot ${selectedRef}.`, refs);
    return;
  }

  fs.mkdirSync(distDir, { recursive: true });
  const extractor = path.join(CORE_ROOT, 'scripts', 'extract-raml-contract.js');
  const result = spawnSync(process.execPath, [extractor, tempRaml, outputPath], {
    cwd: tempDir,
    stdio: 'inherit',
    env: { ...process.env, GUARDIAN_PROJECT_DIR: tempDir, GUARDIAN_CORE_ROOT: CORE_ROOT },
    timeout: 120000
  });

  if (result.status !== 0) {
    writeSkipped(`Falha ao extrair contrato do snapshot ${selectedRef}.`, refs);
    return;
  }

  try {
    const payload = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    payload.status = 'OK';
    payload.source = `git:${selectedRef}`;
    payload.generatedAt = new Date().toISOString();
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (_) {}

  console.log(`✅ Git base contract extraído de ${selectedRef}`);
  console.log(`📄 ${outputPath}`);
}

main();
