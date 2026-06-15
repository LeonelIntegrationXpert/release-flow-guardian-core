const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const {
  PROJECT_DIR,
  CORE_DIR,
  resolveProjectPath,
  loadConfig,
  getBranchName
} = require('./guardian-config');

const DEFAULT_HISTORY_FILE = 'release/history/contract-change-history.jsonl';
const DEFAULT_LATEST_JSON = 'dist/contract-change-history-latest.json';

function safeString(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function runGit(args) {
  try {
    const result = spawnSync('git', args, {
      cwd: PROJECT_DIR,
      encoding: 'utf8',
      shell: false,
      timeout: 15000
    });
    if (result.status !== 0) return '';
    return (result.stdout || '').trim();
  } catch (_) {
    return '';
  }
}

function readJsonSafe(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function getHistoryConfig() {
  const config = loadConfig() || {};
  const history = config.history || config.evidence?.history || {};
  const historyFile = history.file || history.outputFile || DEFAULT_HISTORY_FILE;
  const latestJson = history.latestJson || DEFAULT_LATEST_JSON;
  return {
    enabled: history.enabled !== false,
    file: resolveProjectPath(historyFile),
    latestJson: resolveProjectPath(latestJson),
    maxReadLines: Number(history.maxReadLines || 5000),
    includeGitStatus: history.includeGitStatus !== false,
    includeEnvironment: history.includeEnvironment !== false
  };
}

function sha(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function getActor() {
  const gitName = runGit(['config', 'user.name']);
  const gitEmail = runGit(['config', 'user.email']);
  return {
    name: process.env.GITHUB_ACTOR || process.env.BUILD_REQUESTEDFOR || process.env.USERNAME || process.env.USER || gitName || 'unknown',
    email: process.env.BUILD_REQUESTEDFOREMAIL || gitEmail || process.env.GIT_AUTHOR_EMAIL || '',
    source: process.env.GITHUB_ACTIONS ? 'github-actions' : process.env.TF_BUILD ? 'azure-devops' : 'local',
    gitUserName: gitName,
    gitUserEmail: gitEmail
  };
}

function getGitInfo() {
  const statusRaw = runGit(['status', '--porcelain']);
  const changedFiles = statusRaw
    ? statusRaw.split(/\r?\n/).filter(Boolean).map(line => ({ status: line.slice(0, 2).trim(), file: line.slice(3).trim() }))
    : [];
  const commitSha = process.env.GITHUB_SHA || process.env.BUILD_SOURCEVERSION || runGit(['rev-parse', 'HEAD']);
  return {
    branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || process.env.BUILD_SOURCEBRANCHNAME || getBranchName(),
    commitSha: commitSha || '',
    commitShort: commitSha ? commitSha.slice(0, 12) : '',
    commitAuthorName: runGit(['log', '-1', '--pretty=%an']),
    commitAuthorEmail: runGit(['log', '-1', '--pretty=%ae']),
    commitDate: runGit(['log', '-1', '--pretty=%aI']),
    commitMessage: runGit(['log', '-1', '--pretty=%s']),
    remoteUrl: runGit(['config', '--get', 'remote.origin.url']),
    isDirty: changedFiles.length > 0,
    changedFiles,
    provider: process.env.GITHUB_ACTIONS ? 'github' : process.env.TF_BUILD ? 'azure' : 'local',
    runId: process.env.GITHUB_RUN_ID || process.env.BUILD_BUILDID || '',
    runNumber: process.env.GITHUB_RUN_NUMBER || process.env.BUILD_BUILDNUMBER || ''
  };
}

function getProjectInfo() {
  const config = loadConfig() || {};
  return {
    projectName: config.project?.name || process.env.APP_NAME || path.basename(PROJECT_DIR),
    displayName: config.project?.displayName || config.project?.name || path.basename(PROJECT_DIR),
    assetId: config.exchange?.assetId || process.env.EXCHANGE_ASSET_ID || '',
    mainFile: config.project?.mainFile || config.exchange?.mainFile || 'api.raml',
    projectDir: PROJECT_DIR,
    coreDir: CORE_DIR
  };
}

function ensureHistoryFile() {
  const cfg = getHistoryConfig();
  fs.mkdirSync(path.dirname(cfg.file), { recursive: true });
  fs.mkdirSync(path.dirname(cfg.latestJson), { recursive: true });
  if (!fs.existsSync(cfg.file)) fs.writeFileSync(cfg.file, '', 'utf8');
  return cfg;
}

function readHistory(limit = 200, filters = {}) {
  const cfg = getHistoryConfig();
  if (!fs.existsSync(cfg.file)) return [];
  const raw = fs.readFileSync(cfg.file, 'utf8').split(/\r?\n/).filter(Boolean);
  const selected = raw.slice(Math.max(0, raw.length - Number(limit || 200) * 3));
  const events = [];
  for (const line of selected) {
    try {
      const event = JSON.parse(line);
      if (filters.eventType && event.eventType !== filters.eventType) continue;
      if (filters.action && event.action !== filters.action) continue;
      if (filters.changeType && event.changeType !== filters.changeType) continue;
      events.push(event);
    } catch (_) {}
  }
  return events.slice(-Number(limit || 200)).reverse();
}

function existingHashes() {
  const cfg = getHistoryConfig();
  if (!fs.existsSync(cfg.file)) return new Set();
  const lines = fs.readFileSync(cfg.file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-cfg.maxReadLines);
  const hashes = new Set();
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.eventHash) hashes.add(event.eventHash);
    } catch (_) {}
  }
  return hashes;
}

function buildEventHash(event) {
  return sha({
    eventType: event.eventType,
    action: event.action,
    changeType: event.changeType,
    method: event.method,
    path: event.path,
    oldMethod: event.oldMethod,
    oldPath: event.oldPath,
    newMethod: event.newMethod,
    newPath: event.newPath,
    ruleId: event.ruleId,
    ticket: event.ticket,
    approvalStatus: event.approvalStatus,
    commitSha: event.git?.commitSha || '',
    source: event.source
  });
}

function appendHistoryEvent(input, options = {}) {
  const cfg = ensureHistoryFile();
  if (!cfg.enabled) return null;

  const project = getProjectInfo();
  const git = getGitInfo();
  const actor = getActor();
  const event = {
    eventId: input.eventId || `hist-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${crypto.randomBytes(3).toString('hex')}`,
    createdAt: input.createdAt || new Date().toISOString(),
    source: input.source || options.source || 'guardian-core',
    eventType: input.eventType || 'GUARDIAN_EVENT',
    action: input.action || input.eventType || 'event',
    changeType: input.changeType || '',
    severity: input.severity || '',
    decision: input.decision || '',
    approvalStatus: input.approvalStatus || '',
    project,
    git,
    actor,
    ...input
  };

  event.eventHash = input.eventHash || buildEventHash(event);
  if (options.dedupe !== false && existingHashes().has(event.eventHash)) return null;

  fs.appendFileSync(cfg.file, `${JSON.stringify(event)}\n`, 'utf8');
  const latest = readHistory(250).reverse();
  fs.writeFileSync(cfg.latestJson, JSON.stringify({ generatedAt: new Date().toISOString(), file: cfg.file, events: latest }, null, 2), 'utf8');
  return event;
}

function endpointParts(endpoint = {}) {
  return {
    method: endpoint.method || (endpoint.id ? String(endpoint.id).split(' ')[0] : ''),
    path: endpoint.path || (endpoint.id ? String(endpoint.id).replace(/^\S+\s+/, '') : ''),
    endpointId: endpoint.id || `${endpoint.method || ''} ${endpoint.path || ''}`.trim()
  };
}

function appendHistoryEventsFromDiff(diff, options = {}) {
  const events = [];
  const source = options.source || 'contract-guard';

  for (const endpoint of diff.addedEndpoints || []) {
    const parts = endpointParts(endpoint);
    events.push(appendHistoryEvent({
      source,
      eventType: 'ENDPOINT_CREATED',
      action: 'created',
      changeType: 'new-endpoint',
      severity: 'INFO',
      decision: 'OK',
      ...parts,
      endpoint
    }));
  }

  const possibleOldIds = new Set((diff.possibleReplacements || []).map(p => p.oldId));
  for (const endpoint of diff.removedEndpoints || []) {
    if (possibleOldIds.has(endpoint.id)) continue;
    const parts = endpointParts(endpoint);
    const approved = (diff.approvedBreakingChanges || []).some(item => item.endpoint?.id === endpoint.id || item.endpointId === endpoint.id);
    events.push(appendHistoryEvent({
      source,
      eventType: approved ? 'ENDPOINT_REMOVAL_APPROVED' : 'ENDPOINT_REMOVED',
      action: 'removed',
      changeType: 'removed-endpoint',
      severity: approved ? 'WARN' : 'BLOCK',
      decision: approved ? 'WARN' : 'BLOCK',
      approvalStatus: approved ? 'APPROVED' : 'NOT_APPROVED',
      ...parts,
      endpoint
    }));
  }

  for (const item of diff.changedEndpoints || []) {
    events.push(appendHistoryEvent({
      source,
      eventType: 'ENDPOINT_CHANGED',
      action: 'changed',
      changeType: 'endpoint-changed',
      severity: (item.changes || []).some(c => c.breaking) ? 'BLOCK_OR_WARN' : 'INFO',
      decision: (item.changes || []).some(c => c.breaking) ? 'REVIEW' : 'OK',
      method: item.method,
      path: item.path,
      endpointId: item.id,
      changes: item.changes || []
    }));
  }

  for (const replacement of diff.possibleReplacements || []) {
    events.push(appendHistoryEvent({
      source,
      eventType: replacement.approvalStatus === 'APPROVED' ? 'POSSIBLE_REPLACEMENT_APPROVED' : 'POSSIBLE_REPLACEMENT_DETECTED',
      action: 'possible-replacement',
      changeType: 'possible-replacement',
      severity: replacement.approvalStatus === 'APPROVED' ? 'WARN' : 'BLOCK',
      decision: replacement.decision || (replacement.approvalStatus === 'APPROVED' ? 'WARN' : 'BLOCK'),
      approvalStatus: replacement.approvalStatus || 'NOT_APPROVED',
      oldMethod: replacement.oldMethod,
      oldPath: replacement.oldPath,
      newMethod: replacement.newMethod,
      newPath: replacement.newPath,
      oldEndpointId: replacement.oldId,
      newEndpointId: replacement.newId,
      similarityScore: replacement.similarityScore,
      similarityReasons: replacement.similarityReasons || [],
      ticket: replacement.approval?.ticket || '',
      approvedBy: replacement.approval?.approvedBy || '',
      reason: replacement.approval?.reason || ''
    }));
  }

  for (const finding of diff.findings || []) {
    if (!['BLOCK', 'WARN_APPROVED'].includes(finding.severity)) continue;
    events.push(appendHistoryEvent({
      source,
      eventType: finding.severity === 'BLOCK' ? 'CONTRACT_BLOCK_DETECTED' : 'CONTRACT_WARNING_APPROVED',
      action: finding.severity === 'BLOCK' ? 'blocked' : 'approved-warning',
      changeType: 'contract-finding',
      severity: finding.severity,
      decision: finding.severity === 'BLOCK' ? 'BLOCK' : 'WARN',
      ruleId: finding.ruleId,
      message: finding.message,
      details: finding.details || {},
      ticket: finding.details?.approval?.ticket || '',
      approvedBy: finding.details?.approval?.approvedBy || '',
      reason: finding.details?.approval?.reason || ''
    }));
  }

  if (diff.finalDecision) {
    events.push(appendHistoryEvent({
      source,
      eventType: 'CONTRACT_GUARD_DECISION',
      action: 'decision',
      changeType: 'final-decision',
      severity: diff.finalDecision.status,
      decision: diff.finalDecision.status,
      canPublishExchange: diff.finalDecision.canPublishExchange,
      reason: diff.finalDecision.reason,
      summary: diff.summary || {}
    }, { dedupe: false }));
  }

  return events.filter(Boolean);
}

function getHistorySummary() {
  const events = readHistory(1000).reverse();
  const byType = {};
  const byActor = {};
  const byDecision = {};
  for (const event of events) {
    byType[event.eventType] = (byType[event.eventType] || 0) + 1;
    const actor = event.actor?.email || event.actor?.name || 'unknown';
    byActor[actor] = (byActor[actor] || 0) + 1;
    const decision = event.decision || event.severity || 'INFO';
    byDecision[decision] = (byDecision[decision] || 0) + 1;
  }
  return {
    total: events.length,
    byType,
    byActor,
    byDecision,
    latest: events.slice(-20).reverse(),
    file: getHistoryConfig().file
  };
}

module.exports = {
  getHistoryConfig,
  getActor,
  getGitInfo,
  readHistory,
  getHistorySummary,
  appendHistoryEvent,
  appendHistoryEventsFromDiff
};
