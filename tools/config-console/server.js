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
const { CONFIG_UI_SCHEMA, DEFAULT_CONFIG, applyDefaults, OPTIONS } = require('../../config/guardian-config-ui.schema');
const {
  appendHistoryEvent,
  readHistory,
  getHistorySummary
} = require('../../scripts/guardian-history');
const {
  replacePath,
  insertEndpointBlock,
  extractPathBlock,
  makeUnifiedDiff,
  createBackup
} = require('../../lib/raml/raml-block-extractor');

const CORE_ROOT = process.env.GUARDIAN_CORE_ROOT || CORE_DIR || path.resolve(__dirname, '..', '..');

try { process.chdir(PROJECT_DIR); } catch (_) {}

const HOST = '127.0.0.1';
const PORT = Number(process.env.GUARDIAN_CONSOLE_PORT || 3030);
const PUBLIC_DIR = path.join(__dirname, 'public');
const BREAKING_CHANGES_FILE = resolveProjectPath('release/breaking-changes.yml');
const BASELINE_FILE = resolveProjectPath('release/api-contract-baseline.json');
const CURRENT_CONTRACT_FILE = resolveProjectPath('dist/api-contract-current.json');
const DIFF_FILE = resolveProjectPath('dist/api-contract-diff.json');
const API_RAML_FILE = resolveProjectPath('api.raml');
const BASELINE_RAML_FILE = resolveProjectPath('release/baseline/api.raml');

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

function getByPath(obj, pathExpr) {
  return String(pathExpr).split('.').reduce((acc, key) => acc && acc[key], obj);
}

function isAllowed(value, options) {
  const values = (options || []).map((item) => typeof item === 'object' ? item.value : item);
  return values.includes(String(value || ''));
}

function isBoolean(value) { return typeof value === 'boolean'; }
function isNumberBetween(value, min, max) { const n = Number(value); return Number.isFinite(n) && n >= min && n <= max; }

function validateConfigObject(inputConfig) {
  const config = applyDefaults(inputConfig || {});
  const errors = [];
  const warn = [];
  const push = (condition, message) => { if (!condition) errors.push(message); };

  push(Boolean(config.project?.name), 'project.name obrigatório');
  push(Boolean(config.project?.mainFile), 'project.mainFile obrigatório');
  if (config.project?.mainFile) push(fs.existsSync(resolveProjectPath(config.project.mainFile)), `mainFile não existe: ${config.project.mainFile}`);
  push(Boolean(config.exchange?.assetId), 'exchange.assetId obrigatório');
  push(Boolean(config.exchange?.assetName), 'exchange.assetName obrigatório');
  push(/^\d+\.\d+$/.test(String(config.versioning?.minorLine || '')), 'versioning.minorLine deve estar no formato x.y');
  push(/^\d+\.\d+\.\d+$/.test(String(config.versioning?.initialVersion || '')), 'versioning.initialVersion deve estar no formato x.y.z');

  const allowed = config.versioning?.stability?.allowed || [];
  push(allowed.includes(config.versioning?.stability?.default), 'stability.default precisa estar dentro de stability.allowed');
  push(isAllowed(config.contractGuard?.baselineMode, OPTIONS.baselineMode), 'contractGuard.baselineMode inválido');
  push(isAllowed(config.exchange?.classifier, OPTIONS.classifier), 'exchange.classifier inválido');
  push(isAllowed(config.reports?.style, OPTIONS.reportStyle), 'reports.style inválido');
  push(isAllowed(config.versioning?.strategy, OPTIONS.versioningStrategy), 'versioning.strategy inválido');

  const cd = config.contractGuard?.changeDetection || {};
  push(isNumberBetween(cd.similarityThreshold, 0, 100), 'similarityThreshold precisa estar entre 0 e 100');
  push(isNumberBetween(cd.strongSimilarityThreshold, 0, 100), 'strongSimilarityThreshold precisa estar entre 0 e 100');
  push(Number(cd.strongSimilarityThreshold) >= Number(cd.similarityThreshold), 'strongSimilarityThreshold deve ser maior ou igual ao similarityThreshold');
  for (const key of ['sameMethodWeight','pathSimilarityWeight','sameFirstSegmentWeight','sameVersionWeight','uriParamsSimilarityWeight','queryParamsSimilarityWeight','responsesSimilarityWeight']) {
    push(Number(cd[key]) >= 0, `${key} precisa ser número >= 0`);
  }

  const behavior = config.contractGuard?.defaultBehavior || {};
  for (const key of ['newEndpoint','removedEndpoint','possibleReplacement','replacedEndpointWithoutApproval','changedBreakingEndpoint','changedNonBreakingEndpoint','approvedBreakingChange']) {
    push(['ok','warn','block'].includes(String(behavior[key] || '')), `defaultBehavior.${key} precisa ser ok, warn ou block`);
  }

  for (const key of ['enabled','blockRemovedEndpoints','blockRemovedMethods','blockRemovedRequiredQueryParams','blockRemovedUriParams','blockRemovedSuccessResponses','blockRemovedSecurity','blockRemovedTraits','allowApprovedBreakingChanges']) {
    push(isBoolean(config.contractGuard?.[key]), `contractGuard.${key} precisa ser boolean`);
  }

  if (config.contractGuard?.baselineFile) push(fs.existsSync(resolveProjectPath(config.contractGuard.baselineFile)), `baselineFile não existe: ${config.contractGuard.baselineFile}`);
  if (config.contractGuard?.breakingChangesFile) push(fs.existsSync(resolveProjectPath(config.contractGuard.breakingChangesFile)), `breakingChangesFile não existe: ${config.contractGuard.breakingChangesFile}`);
  if (!config.restore?.createBackupBeforeRestore) warn.push('Restore sem backup antes de restaurar não é recomendado.');
  if (config.contractGuard?.baselineMode === 'disabled') warn.push('Baseline Guard desativado não é recomendado para produção.');

  return { valid: errors.length === 0, errors, warnings: warn, config };
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
  bc.changedEndpoints = Array.isArray(bc.changedEndpoints) ? bc.changedEndpoints : [];
  bc.replacedEndpoints = Array.isArray(bc.replacedEndpoints) ? bc.replacedEndpoints : [];
  bc.possibleReplacements = Array.isArray(bc.possibleReplacements) ? bc.possibleReplacements : [];
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
  appendHistoryEvent({
    source: 'guardian-console',
    eventType: 'ENDPOINT_REMOVAL_APPROVAL_CREATED',
    action: 'approved',
    changeType: 'removed-endpoint',
    severity: 'WARN',
    decision: 'WARN',
    approvalStatus: 'APPROVED',
    method: item.method,
    path: item.path,
    ticket: input.ticket,
    approvedBy: input.approvedBy,
    reason: input.reason,
    replacement: item.replacement,
    notes: item.notes
  }, { dedupe: false });
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
  appendHistoryEvent({
    source: 'guardian-console',
    eventType: 'ENDPOINT_REMOVAL_APPROVAL_REVOKED',
    action: 'revoked',
    changeType: 'removed-endpoint',
    severity: 'WARN',
    decision: 'REVOKED',
    approvalStatus: 'REVOKED',
    method,
    path: endpointPath
  }, { dedupe: false });
  return data;
}

function addBreakingApproval(input) {
  const type = String(input.type || input.approvalType || 'removedEndpoint');
  const required = ['ticket', 'approvedBy', 'reason'];
  for (const key of required) {
    if (!input[key]) throw new Error(`Campo obrigatório ausente: ${key}`);
  }

  const data = normalizeBreakingChanges(readYamlFile(BREAKING_CHANGES_FILE, { breakingChanges: {} }));
  const bc = data.breakingChanges;
  bc.approved = true;
  bc.ticket = input.ticket;
  bc.approvedBy = input.approvedBy;
  bc.reason = input.reason;

  const base = {
    ticket: input.ticket,
    approvedBy: input.approvedBy,
    reason: input.reason,
    approvedAt: new Date().toISOString(),
    notes: input.notes || ''
  };

  if (type === 'possibleReplacement' || type === 'replacement' || type === 'changedEndpoint') {
    const oldMethod = String(input.oldMethod || input.method || '').toUpperCase();
    const newMethod = String(input.newMethod || input.method || '').toUpperCase();
    const oldPath = input.oldPath || input.path;
    const newPath = input.newPath || input.replacement;
    if (!oldMethod || !oldPath || !newMethod || !newPath) {
      throw new Error('Aprovação de alteração/substituição exige oldMethod, oldPath, newMethod e newPath.');
    }

    const item = {
      ...base,
      oldMethod,
      oldPath,
      newMethod,
      newPath,
      similarityScore: Number(input.similarityScore || 0),
      breaking: true,
      replacementType: input.replacementType || (type === 'changedEndpoint' ? 'path-changed' : 'possible-replacement')
    };

    const targetList = type === 'changedEndpoint' ? bc.changedEndpoints : type === 'replacement' ? bc.replacedEndpoints : bc.possibleReplacements;
    const exists = targetList.some((entry) => String(entry.oldMethod || entry.method || '').toUpperCase() === oldMethod && entry.oldPath === oldPath && String(entry.newMethod || entry.method || '').toUpperCase() === newMethod && entry.newPath === newPath);
    if (!exists) targetList.push(item);
  } else {
    const method = String(input.method || '').toUpperCase();
    const endpointPath = input.path || input.oldPath;
    if (!method || !endpointPath) throw new Error('Aprovação de remoção exige method e path.');
    const item = {
      ...base,
      method,
      path: endpointPath,
      replacement: input.replacement || input.newPath || ''
    };
    const exists = bc.removedEndpoints.some((entry) => String(entry.method || '').toUpperCase() === method && entry.path === endpointPath);
    if (!exists) bc.removedEndpoints.push(item);
  }

  backupFile(BREAKING_CHANGES_FILE);
  writeYamlFile(BREAKING_CHANGES_FILE, data);
  appendHistoryEvent({
    source: 'guardian-console',
    eventType: type === 'possibleReplacement' ? 'POSSIBLE_REPLACEMENT_APPROVAL_CREATED' : type === 'replacement' ? 'REPLACEMENT_APPROVAL_CREATED' : type === 'changedEndpoint' ? 'ENDPOINT_CHANGE_APPROVAL_CREATED' : 'ENDPOINT_REMOVAL_APPROVAL_CREATED',
    action: 'approved',
    changeType: type,
    severity: 'WARN',
    decision: 'WARN',
    approvalStatus: 'APPROVED',
    method: input.method || input.oldMethod || '',
    path: input.path || input.oldPath || '',
    oldMethod: input.oldMethod || input.method || '',
    oldPath: input.oldPath || input.path || '',
    newMethod: input.newMethod || input.method || '',
    newPath: input.newPath || input.replacement || '',
    similarityScore: Number(input.similarityScore || 0),
    ticket: input.ticket,
    approvedBy: input.approvedBy,
    reason: input.reason,
    notes: input.notes || ''
  }, { dedupe: false });
  return data;
}

function revokeBreakingApproval(input) {
  const data = normalizeBreakingChanges(readYamlFile(BREAKING_CHANGES_FILE, { breakingChanges: {} }));
  const bc = data.breakingChanges;
  const oldMethod = String(input.oldMethod || input.method || '').toUpperCase();
  const newMethod = String(input.newMethod || input.method || '').toUpperCase();
  const oldPath = input.oldPath || input.path || '';
  const newPath = input.newPath || input.replacement || '';

  bc.removedEndpoints = bc.removedEndpoints.filter((entry) => !(String(entry.method || '').toUpperCase() === oldMethod && entry.path === oldPath));
  for (const key of ['changedEndpoints', 'replacedEndpoints', 'possibleReplacements']) {
    bc[key] = bc[key].filter((entry) => !(String(entry.oldMethod || entry.method || '').toUpperCase() === oldMethod && String(entry.oldPath || entry.path || '') === oldPath && (!newPath || String(entry.newMethod || entry.method || '').toUpperCase() === newMethod) && (!newPath || String(entry.newPath || entry.replacement || '') === newPath)));
  }

  if (!bc.removedEndpoints.length && !bc.changedEndpoints.length && !bc.replacedEndpoints.length && !bc.possibleReplacements.length && !bc.approvedRules.length) bc.approved = false;
  backupFile(BREAKING_CHANGES_FILE);
  writeYamlFile(BREAKING_CHANGES_FILE, data);
  appendHistoryEvent({
    source: 'guardian-console',
    eventType: 'BREAKING_CHANGE_APPROVAL_REVOKED',
    action: 'revoked',
    changeType: 'breaking-change-approval',
    severity: 'WARN',
    decision: 'REVOKED',
    approvalStatus: 'REVOKED',
    oldMethod,
    oldPath,
    newMethod,
    newPath
  }, { dedupe: false });
  return data;
}


function readTextFile(file, fallback = '') {
  if (!fs.existsSync(file)) return fallback;
  return fs.readFileSync(file, 'utf8');
}

function writeTextFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function restoreConfig() {
  const cfg = loadConfig();
  const restore = cfg.restore || {};
  return {
    enabled: restore.enabled !== false,
    confirmationText: restore.confirmationText || 'CONFIRMO RESTAURAR CONTRATO',
    requireConfirmation: restore.requireConfirmation !== false,
    createBackupBeforeRestore: restore.createBackupBeforeRestore !== false,
    backupDir: resolveProjectPath(restore.backupDir || 'release/backups'),
    allowRestoreEndpointPath: restore.allowRestoreEndpointPath !== false,
    allowRestoreEndpointBlock: restore.allowRestoreEndpointBlock !== false,
    runValidationAfterRestore: restore.runValidationAfterRestore !== false,
    runContractGuardAfterRestore: restore.runContractGuardAfterRestore !== false,
    revokeApprovalAfterRestoreDefault: restore.revokeApprovalAfterRestoreDefault !== false
  };
}

function responseFromRestorePreview(payload) {
  const body = payload || {};
  const type = body.restoreType || body.type || 'path-restore';
  const currentRaml = readTextFile(API_RAML_FILE, '');
  const baselineRaml = readTextFile(BASELINE_RAML_FILE, '');
  if (!currentRaml) return { ok: false, error: 'api.raml não encontrado no projeto.' };

  if (type === 'endpoint-block-restore') {
    if (!baselineRaml) return { ok: false, error: 'Snapshot release/baseline/api.raml não existe. Restore completo exige baseline RAML.' };
    const result = insertEndpointBlock(currentRaml, baselineRaml, body.oldPath || body.path || body.baselinePath);
    return { ...result, restoreType: 'endpoint-block-restore', baselineAvailable: true, baselinePath: body.oldPath || body.path || body.baselinePath };
  }

  const currentPath = body.newPath || body.currentPath || body.path;
  const baselinePath = body.oldPath || body.baselinePath;
  if (!currentPath || !baselinePath) return { ok: false, error: 'Restore de path exige oldPath/baselinePath e newPath/currentPath.' };
  const result = replacePath(currentRaml, currentPath, baselinePath);
  return { ...result, restoreType: 'path-restore', method: body.oldMethod || body.method || '', baselinePath, currentPathBeforeRestore: currentPath, currentPathAfterRestore: baselinePath, similarityScore: body.similarityScore || 0 };
}

function runAfterRestoreValidation(options = {}) {
  const results = {};
  if (options.runExtract !== false) {
    const extract = runNode('scripts/extract-raml-contract.js', ['api.raml', CURRENT_CONTRACT_FILE]);
    results.extract = { status: extract.status, stdout: extract.stdout || '', stderr: extract.stderr || '' };
  }
  if (options.runGuard !== false) {
    const guard = runNode('scripts/compare-api-contract.js', ['api.raml']);
    results.contractGuard = { status: guard.status, stdout: guard.stdout || '', stderr: guard.stderr || '' };
  }
  return results;
}

function writeRestorePatch(diff) {
  const dir = resolveProjectPath('dist/restore-patches');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `restore-api-raml-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}.patch`);
  fs.writeFileSync(file, diff || '', 'utf8');
  return file;
}

function relatedApprovalPayload(body) {
  return {
    oldMethod: body.oldMethod || body.method || '',
    oldPath: body.oldPath || body.baselinePath || body.path || '',
    newMethod: body.newMethod || body.method || '',
    newPath: body.newPath || body.currentPath || body.replacement || ''
  };
}

async function handleApi(req, res, url) {
  try {
    if (req.method === 'GET' && url.pathname === '/api/config') {
      const config = loadConfig();
      return json(res, 200, { config, stability: resolveStability(config), runtime: { projectDir: PROJECT_DIR, coreDir: CORE_ROOT, ref: process.env.GUARDIAN_CORE_REF || process.env.CORE_REF || 'local' } });
    }
    if (req.method === 'GET' && url.pathname === '/api/config/schema') {
      return json(res, 200, { schema: CONFIG_UI_SCHEMA, defaults: DEFAULT_CONFIG });
    }
    if (req.method === 'GET' && url.pathname === '/api/config/defaults') {
      return json(res, 200, { defaults: DEFAULT_CONFIG });
    }
    if (req.method === 'GET' && url.pathname === '/api/config/presets') {
      return json(res, 200, { presets: CONFIG_UI_SCHEMA.presets });
    }
    if (req.method === 'POST' && url.pathname === '/api/config/validate') {
      const body = await readBody(req);
      return json(res, 200, validateConfigObject(body.config || body));
    }
    if (req.method === 'POST' && url.pathname === '/api/config/save') {
      const body = await readBody(req);
      const config = applyDefaults(body.config || body);
      const validation = validateConfigObject(config);
      if (!validation.valid) return json(res, 400, validation);
      const backup = backupFile(CONFIG_PATH);
      writeYamlFile(CONFIG_PATH, config);
      appendHistoryEvent({
        source: 'guardian-console',
        eventType: 'CONFIG_UPDATED',
        action: 'updated',
        changeType: 'config-file',
        severity: 'INFO',
        decision: 'OK',
        file: 'release/guardian.config.yml',
        backup
      }, { dedupe: false });
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
      appendHistoryEvent({
        source: 'guardian-console',
        eventType: 'BREAKING_CHANGES_UPDATED',
        action: 'updated',
        changeType: 'breaking-changes-file',
        severity: 'INFO',
        decision: 'OK',
        file: 'release/breaking-changes.yml',
        backup,
        approved: data.breakingChanges?.approved,
        ticket: data.breakingChanges?.ticket || '',
        approvedBy: data.breakingChanges?.approvedBy || '',
        reason: data.breakingChanges?.reason || ''
      }, { dedupe: false });
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
    if (req.method === 'POST' && url.pathname === '/api/breaking-changes/approve') {
      const body = await readBody(req);
      return json(res, 200, addBreakingApproval(body));
    }
    if (req.method === 'POST' && url.pathname === '/api/breaking-changes/revoke') {
      const body = await readBody(req);
      return json(res, 200, revokeBreakingApproval(body));
    }
    if (req.method === 'GET' && url.pathname === '/api/history') {
      const limit = Number(url.searchParams.get('limit') || 200);
      return json(res, 200, { events: readHistory(limit), summary: getHistorySummary() });
    }
    if (req.method === 'GET' && url.pathname === '/api/history/summary') {
      return json(res, 200, getHistorySummary());
    }
    if (req.method === 'GET' && url.pathname === '/api/raml/current') {
      return json(res, 200, { exists: fs.existsSync(API_RAML_FILE), file: 'api.raml', content: readTextFile(API_RAML_FILE, '') });
    }
    if (req.method === 'GET' && url.pathname === '/api/raml/baseline') {
      return json(res, 200, { exists: fs.existsSync(BASELINE_RAML_FILE), file: 'release/baseline/api.raml', content: readTextFile(BASELINE_RAML_FILE, ''), message: fs.existsSync(BASELINE_RAML_FILE) ? '' : 'Snapshot RAML do baseline ainda não existe. O Guardian pode comparar contratos pelo JSON, mas o restore completo de bloco RAML exige um snapshot do RAML aprovado.' });
    }
    if (req.method === 'GET' && url.pathname === '/api/raml/diff') {
      const current = readTextFile(API_RAML_FILE, '');
      const baseline = readTextFile(BASELINE_RAML_FILE, '');
      return json(res, 200, { baselineAvailable: Boolean(baseline), diff: baseline ? makeUnifiedDiff(baseline, current, 'release/baseline/api.raml', 'api.raml') : 'Snapshot release/baseline/api.raml não existe. Diff RAML completo indisponível.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/restore/preview') {
      const body = await readBody(req);
      const preview = responseFromRestorePreview(body);
      appendHistoryEvent({ source: 'guardian-console', eventType: 'RESTORE_PREVIEW_GENERATED', action: 'preview', changeType: preview.restoreType || body.restoreType || 'restore', severity: preview.ok ? 'INFO' : 'WARN', decision: preview.ok ? 'PREVIEW' : 'FAILED', oldMethod: body.oldMethod || body.method || '', oldPath: body.oldPath || body.baselinePath || '', newMethod: body.newMethod || body.method || '', newPath: body.newPath || body.currentPath || '', similarityScore: Number(body.similarityScore || 0), message: preview.error || preview.reason || '' }, { dedupe: false });
      return json(res, preview.ok ? 200 : 400, preview);
    }
    if (req.method === 'POST' && url.pathname === '/api/restore/generate-patch') {
      const body = await readBody(req);
      const preview = responseFromRestorePreview(body);
      if (!preview.ok) return json(res, 400, preview);
      const patchFile = writeRestorePatch(preview.diff);
      appendHistoryEvent({ source: 'guardian-console', eventType: 'RESTORE_PATCH_GENERATED', action: 'generated', changeType: preview.restoreType, severity: 'INFO', decision: 'OK', file: patchFile, oldMethod: body.oldMethod || body.method || '', oldPath: body.oldPath || body.baselinePath || '', newMethod: body.newMethod || body.method || '', newPath: body.newPath || body.currentPath || '' }, { dedupe: false });
      return json(res, 200, { generated: true, patchFile, diff: preview.diff });
    }
    if (req.method === 'POST' && url.pathname === '/api/restore/apply') {
      const body = await readBody(req);
      const cfg = restoreConfig();
      if (!cfg.enabled) return json(res, 400, { ok: false, error: 'Restore está desabilitado na configuração.' });
      if (cfg.requireConfirmation && body.confirmationText !== cfg.confirmationText) return json(res, 400, { ok: false, error: `Confirmação inválida. Digite exatamente: ${cfg.confirmationText}` });
      const preview = responseFromRestorePreview(body);
      if (!preview.ok) return json(res, 400, preview);
      let backup = null;
      if (cfg.createBackupBeforeRestore) {
        backup = createBackup(API_RAML_FILE, cfg.backupDir, { eventType: 'RESTORE_BACKUP_CREATED', restoreType: preview.restoreType, oldPath: body.oldPath || body.baselinePath, newPath: body.newPath || body.currentPath });
        appendHistoryEvent({ source: 'guardian-console', eventType: 'RESTORE_BACKUP_CREATED', action: 'backup', changeType: preview.restoreType, severity: 'INFO', decision: 'OK', file: backup.backupFile, oldMethod: body.oldMethod || body.method || '', oldPath: body.oldPath || body.baselinePath || '', newMethod: body.newMethod || body.method || '', newPath: body.newPath || body.currentPath || '' }, { dedupe: false });
      }
      writeTextFile(API_RAML_FILE, preview.after);
      let revoked = null;
      if (body.revokeApproval) {
        try { revoked = revokeBreakingApproval(relatedApprovalPayload(body)); } catch (error) { revoked = { error: error.message }; }
      }
      const validation = runAfterRestoreValidation({ runExtract: cfg.runValidationAfterRestore, runGuard: cfg.runContractGuardAfterRestore });
      const eventType = preview.restoreType === 'endpoint-block-restore' ? 'ENDPOINT_BLOCK_RESTORED' : 'ENDPOINT_PATH_RESTORED';
      appendHistoryEvent({ source: 'guardian-console', eventType, action: 'restored', changeType: preview.restoreType, severity: validation.contractGuard && validation.contractGuard.status !== 0 ? 'WARN' : 'INFO', decision: validation.contractGuard && validation.contractGuard.status !== 0 ? 'RESTORED_WITH_WARNINGS' : 'OK', method: body.oldMethod || body.method || '', baselinePath: body.oldPath || body.baselinePath || '', currentPathBeforeRestore: body.newPath || body.currentPath || '', currentPathAfterRestore: body.oldPath || body.baselinePath || '', oldMethod: body.oldMethod || body.method || '', oldPath: body.oldPath || body.baselinePath || '', newMethod: body.newMethod || body.method || '', newPath: body.newPath || body.currentPath || '', similarityScore: Number(body.similarityScore || 0), backupFile: backup?.backupFile || '', metadataFile: backup?.metadataFile || '' }, { dedupe: false });
      if (body.revokeApproval) appendHistoryEvent({ source: 'guardian-console', eventType: 'BREAKING_CHANGE_REVOKED_AFTER_RESTORE', action: 'revoked', changeType: 'approval-after-restore', severity: 'INFO', decision: 'REVOKED', oldMethod: body.oldMethod || body.method || '', oldPath: body.oldPath || body.baselinePath || '', newMethod: body.newMethod || body.method || '', newPath: body.newPath || body.currentPath || '' }, { dedupe: false });
      return json(res, 200, { ok: true, backup, revoked, validation, restoreType: preview.restoreType });
    }
    if (req.method === 'GET' && url.pathname === '/api/restore/history') {
      const events = readHistory(300).filter(e => String(e.eventType || '').includes('RESTORE') || String(e.eventType || '').includes('RESTORED'));
      return json(res, 200, { events });
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
