#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const YAML = require('yaml');
const {
  PROJECT_DIR,
  CORE_DIR,
  CONFIG_PATH,
  resolveProjectPath,
  readYamlFile,
  writeYamlFile,
  backupFile,
  loadConfig,
  resolveStability
} = require('../../scripts/guardian-config');

const CORE_ROOT = process.env.GUARDIAN_CORE_ROOT || CORE_DIR || path.resolve(__dirname, '..', '..');

try { process.chdir(PROJECT_DIR); } catch (_) {}

const HOST = '127.0.0.1';
const PORT = Number(process.env.GUARDIAN_CONSOLE_PORT || 3030);
const PUBLIC_DIR = path.join(__dirname, 'public');
const BREAKING_CHANGES_FILE = resolveProjectPath('release/breaking-changes.yml');
const BASELINE_FILE = resolveProjectPath('release/api-contract-baseline.json');
const CURRENT_CONTRACT_FILE = resolveProjectPath('dist/api-contract-current.json');
const DIFF_FILE = resolveProjectPath('dist/api-contract-diff.json');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function withCors(headers = {}) {
  return { ...CORS_HEADERS, ...headers };
}

function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, withCors({ 'Content-Type': 'application/json; charset=utf-8' }));
  res.end(body);
}

function text(res, status, body, type = 'text/plain') {
  res.writeHead(status, withCors({ 'Content-Type': `${type}; charset=utf-8` }));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function runNode(script, args = []) {
  const fullScript = path.isAbsolute(script) ? script : path.join(CORE_ROOT, script);
  return spawnSync(process.execPath, [fullScript, ...args], {
    cwd: PROJECT_DIR,
    encoding: 'utf8',
    env: { ...process.env, GUARDIAN_PROJECT_DIR: PROJECT_DIR, GUARDIAN_CORE_ROOT: CORE_ROOT, GUARDIAN_CONFIG: CONFIG_PATH },
    timeout: 120000
  });
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validateConfigObject(config) {
  const errors = [];
  if (!config.project?.name) errors.push('project.name obrigatório');
  if (!config.project?.mainFile) errors.push('project.mainFile obrigatório');
  if (config.project?.mainFile && !fs.existsSync(resolveProjectPath(config.project.mainFile))) errors.push(`mainFile não existe: ${config.project.mainFile}`);
  if (!config.exchange?.assetId) errors.push('exchange.assetId obrigatório');
  if (!/^\d+\.\d+$/.test(String(config.versioning?.minorLine || ''))) errors.push('versioning.minorLine deve estar no formato x.y');
  if (!/^\d+\.\d+\.\d+$/.test(String(config.versioning?.initialVersion || ''))) errors.push('versioning.initialVersion deve estar no formato x.y.z');
  const allowed = config.versioning?.stability?.allowed || [];
  if (!allowed.includes(config.versioning?.stability?.default)) errors.push('stability.default precisa estar dentro de stability.allowed');
  if (Number(config.exchange?.autoBump?.max409Retries) < 0) errors.push('max409Retries precisa ser >= 0');
  return { valid: errors.length === 0, errors };
}

function ensureContracts() {
  fs.mkdirSync(resolveProjectPath('dist'), { recursive: true });
  const config = loadConfig();
  const mainFile = config.project?.mainFile || config.exchange?.mainFile || 'api.raml';
  const extract = runNode('scripts/extract-raml-contract.js', [mainFile, CURRENT_CONTRACT_FILE]);
  const compare = runNode('scripts/compare-api-contract.js', ['api.raml']);
  return { extract, compare };
}

function loadDiffSafe() {
  if (!fs.existsSync(DIFF_FILE)) ensureContracts();
  return readJson(DIFF_FILE, { status: 'NOT_EXECUTED', findings: [], addedEndpoints: [], removedEndpoints: [], changedEndpoints: [], summary: {} });
}

function normalizeBreakingChanges(raw) {
  const data = raw?.breakingChanges ? raw : { breakingChanges: raw || {} };
  const bc = data.breakingChanges || {};
  bc.approved = Boolean(bc.approved);
  bc.ticket = bc.ticket || '';
  bc.approvedBy = bc.approvedBy || '';
  bc.reason = bc.reason || '';
  bc.allowAllBreakingChanges = Boolean(bc.allowAllBreakingChanges);
  bc.removedEndpoints = Array.isArray(bc.removedEndpoints) ? bc.removedEndpoints : [];
  bc.removedMethods = Array.isArray(bc.removedMethods) ? bc.removedMethods : [];
  bc.removedQueryParams = Array.isArray(bc.removedQueryParams) ? bc.removedQueryParams : [];
  bc.removedUriParams = Array.isArray(bc.removedUriParams) ? bc.removedUriParams : [];
  bc.removedResponses = Array.isArray(bc.removedResponses) ? bc.removedResponses : [];
  bc.removedSecurity = Array.isArray(bc.removedSecurity) ? bc.removedSecurity : [];
  bc.removedTraits = Array.isArray(bc.removedTraits) ? bc.removedTraits : [];
  bc.approvedRules = Array.isArray(bc.approvedRules) ? bc.approvedRules : [];
  bc.notes = bc.notes || '';
  return { breakingChanges: bc };
}

function addEndpointApproval(input) {
  const required = ['method', 'path', 'ticket', 'approvedBy', 'reason'];
  for (const key of required) {
    if (!input[key]) throw new Error(`Campo obrigatório ausente: ${key}`);
  }
  const data = normalizeBreakingChanges(readYamlFile(BREAKING_CHANGES_FILE, { breakingChanges: {} }));
  const bc = data.breakingChanges;
  bc.approved = true;
  bc.ticket = input.ticket;
  bc.approvedBy = input.approvedBy;
  bc.reason = input.reason;
  const item = {
    method: String(input.method).toUpperCase(),
    path: input.path,
    replacement: input.replacement || '',
    approvedAt: new Date().toISOString(),
    notes: input.notes || ''
  };
  const exists = bc.removedEndpoints.some(e => String(e.method).toUpperCase() === item.method && e.path === item.path);
  if (!exists) bc.removedEndpoints.push(item);
  backupFile(BREAKING_CHANGES_FILE);
  writeYamlFile(BREAKING_CHANGES_FILE, data);
  return data;
}

function revokeEndpointApproval(input) {
  const data = normalizeBreakingChanges(readYamlFile(BREAKING_CHANGES_FILE, { breakingChanges: {} }));
  const bc = data.breakingChanges;
  const method = String(input.method || '').toUpperCase();
  const endpointPath = input.path || '';
  bc.removedEndpoints = bc.removedEndpoints.filter(e => !(String(e.method || '').toUpperCase() === method && e.path === endpointPath));
  if (!bc.removedEndpoints.length && !bc.approvedRules.length) bc.approved = false;
  backupFile(BREAKING_CHANGES_FILE);
  writeYamlFile(BREAKING_CHANGES_FILE, data);
  return data;
}

async function handleApi(req, res, url) {
  try {
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return json(res, 200, { config: loadConfig(), stability: resolveStability(loadConfig()), runtime: { projectDir: PROJECT_DIR, coreDir: CORE_ROOT, ref: process.env.GUARDIAN_CORE_REF || process.env.CORE_REF || 'local' } });
    }
    if (req.method === 'POST' && url.pathname === '/api/config/validate') {
      const body = await readBody(req);
      return json(res, 200, validateConfigObject(body.config || body));
    }
    if (req.method === 'POST' && url.pathname === '/api/config/save') {
      const body = await readBody(req);
      const config = body.config || body;
      const validation = validateConfigObject(config);
      if (!validation.valid) return json(res, 400, validation);
      const backup = backupFile(CONFIG_PATH);
      writeYamlFile(CONFIG_PATH, config);
      return json(res, 200, { saved: true, backup });
    }
    if (req.method === 'GET' && url.pathname === '/api/breaking-changes') {
      return json(res, 200, normalizeBreakingChanges(readYamlFile(BREAKING_CHANGES_FILE, { breakingChanges: {} })));
    }
    if (req.method === 'POST' && url.pathname === '/api/breaking-changes/save') {
      const body = await readBody(req);
      const data = normalizeBreakingChanges(body);
      const bc = data.breakingChanges;
      if (bc.approved && (!bc.ticket || !bc.approvedBy || !bc.reason)) {
        return json(res, 400, { valid: false, errors: ['Aprovação exige ticket, approvedBy e reason.'] });
      }
      const backup = backupFile(BREAKING_CHANGES_FILE);
      writeYamlFile(BREAKING_CHANGES_FILE, data);
      return json(res, 200, { saved: true, backup, data });
    }
    if (req.method === 'GET' && url.pathname === '/api/endpoints/current') {
      ensureContracts();
      return json(res, 200, readJson(CURRENT_CONTRACT_FILE, { endpoints: [] }));
    }
    if (req.method === 'GET' && url.pathname === '/api/endpoints/baseline') {
      return json(res, 200, readJson(BASELINE_FILE, { endpoints: [] }));
    }
    if (req.method === 'GET' && url.pathname === '/api/endpoints/diff') {
      ensureContracts();
      return json(res, 200, loadDiffSafe());
    }
    if (req.method === 'POST' && url.pathname === '/api/endpoints/approve-removal') {
      const body = await readBody(req);
      return json(res, 200, addEndpointApproval(body));
    }
    if (req.method === 'POST' && url.pathname === '/api/endpoints/revoke-removal') {
      const body = await readBody(req);
      return json(res, 200, revokeEndpointApproval(body));
    }
    if (req.method === 'GET' && url.pathname === '/api/report/latest') {
      return json(res, 200, readJson(resolveProjectPath('dist/release-flow-guardian-report.json'), { status: 'NOT_FOUND' }));
    }
    return json(res, 404, { error: 'API route not found' });
  } catch (error) {
    return json(res, 500, { error: error.message, stack: error.stack });
  }
}

function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file)) return text(res, 404, 'Not found');
  const ext = path.extname(file).toLowerCase();
  const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'text/plain';
  res.writeHead(200, withCors({ 'Content-Type': `${type}; charset=utf-8` }));
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, withCors());
    return res.end();
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log('================================================================================');
  console.log('Release Flow Guardian Console');
  console.log('================================================================================');
  console.log(`URL: http://${HOST}:${PORT}`);
  console.log(`Projeto carregado: ${PROJECT_DIR}`);
  console.log(`Core carregado: ${CORE_ROOT}`);
  console.log('Ferramenta local. Não exponha em rede pública.');
});
