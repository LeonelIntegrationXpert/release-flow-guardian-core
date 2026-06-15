#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const YAML = require('yaml');
const raml = require('raml-1-parser');

const DIST_DIR = process.env.DIST_DIR || 'dist';
const CURRENT_RAML = process.env.API_MAIN_FILE || process.argv[2] || 'api.raml';
const CURRENT_CONTRACT = process.env.API_CONTRACT_CURRENT || path.join(DIST_DIR, 'api-contract-current.json');
const BASELINE_USED = process.env.API_CONTRACT_BASELINE_USED || path.join(DIST_DIR, 'api-contract-baseline-used.json');
const DIFF_JSON = process.env.API_CONTRACT_DIFF_JSON || path.join(DIST_DIR, 'api-contract-diff.json');
const DIFF_MD = process.env.API_CONTRACT_DIFF_MD || path.join(DIST_DIR, 'api-contract-diff.md');
const BREAKING_CHANGES_FILE = process.env.BREAKING_CHANGES_FILE || 'release/breaking-changes.yml';
const STATIC_BASELINE_FILE = process.env.API_CONTRACT_BASELINE_FILE || 'release/api-contract-baseline.json';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    shell: false,
    timeout: options.timeout || 120000,
    env: process.env
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: `${result.stdout || ''}\n${result.stderr || ''}`.trim(),
    error: result.error
  };
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeType(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).sort();
  return [String(value)];
}

function getNamedMap(raw) {
  const result = {};
  if (!raw) return result;

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item) continue;
      const name = item.name || item.displayName || item.key;
      if (name) result[name] = item;
    }
    return result;
  }

  if (typeof raw === 'object') {
    for (const [name, value] of Object.entries(raw)) result[name] = value || {};
  }

  return result;
}

function normalizeParameters(raw) {
  const params = getNamedMap(raw);
  const result = {};

  for (const [name, param] of Object.entries(params)) {
    result[name] = {
      name,
      required: Boolean(param.required),
      type: normalizeType(param.type),
      enum: asArray(param.enum).map(String).sort(),
      pattern: param.pattern || null,
      default: param.default ?? null,
      description: param.description || ''
    };
  }

  return result;
}

function normalizeBodies(raw) {
  const bodies = getNamedMap(raw);
  const result = {};

  for (const [mediaType, body] of Object.entries(bodies)) {
    result[mediaType] = {
      mediaType,
      type: normalizeType(body.type),
      required: Boolean(body.required)
    };
  }

  return result;
}

function normalizeResponses(raw) {
  const responses = getNamedMap(raw);
  const result = {};

  for (const [code, response] of Object.entries(responses)) {
    result[String(code)] = {
      code: String(code),
      description: response.description || '',
      body: normalizeBodies(response.body)
    };
  }

  return result;
}

function normalizeMethod(methodJson, fullPath) {
  const method = String(methodJson.method || '').toUpperCase();
  const id = `${method} ${fullPath}`;
  return {
    id,
    method,
    path: fullPath,
    displayName: methodJson.displayName || '',
    description: methodJson.description || '',
    queryParameters: normalizeParameters(methodJson.queryParameters),
    body: normalizeBodies(methodJson.body),
    responses: normalizeResponses(methodJson.responses),
    securedBy: asArray(methodJson.securedBy).map(String).filter(Boolean).sort(),
    traits: asArray(methodJson.is).map(String).filter(Boolean).sort(),
    protocols: asArray(methodJson.protocols).map(String).filter(Boolean).sort()
  };
}

function normalizeTypeProperties(typeDefinition, prefix = '') {
  const properties = {};
  const rawProperties = getNamedMap(typeDefinition.properties);

  for (const [propertyName, property] of Object.entries(rawProperties)) {
    const propertyPath = prefix ? `${prefix}.${propertyName}` : propertyName;
    properties[propertyPath] = {
      name: propertyName,
      path: propertyPath,
      required: Boolean(property.required),
      type: normalizeType(property.type),
      enum: asArray(property.enum).map(String).sort()
    };

    if (property.properties) {
      Object.assign(properties, normalizeTypeProperties(property, propertyPath));
    }
  }

  return properties;
}

function normalizeTypes(apiJson) {
  const result = {};
  for (const entry of apiJson.types || []) {
    for (const [typeName, typeDefinition] of Object.entries(entry || {})) {
      result[typeName] = {
        name: typeName,
        type: normalizeType(typeDefinition.type),
        properties: normalizeTypeProperties(typeDefinition)
      };
    }
  }
  return result;
}

function normalizeSecuritySchemes(apiJson) {
  const result = [];
  for (const entry of apiJson.securitySchemes || []) {
    for (const name of Object.keys(entry || {})) result.push(name);
  }
  return [...new Set(result)].sort();
}

function normalizeTraits(apiJson) {
  const result = [];
  for (const entry of apiJson.traits || []) {
    for (const name of Object.keys(entry || {})) result.push(name);
  }
  return [...new Set(result)].sort();
}

async function extractContract(file) {
  const api = await raml.loadApi(file, { rejectOnErrors: false });
  const errors = api.errors();

  if (errors && errors.length) {
    const details = errors.map((error) => `${error.message} (${error.path || file})`).join('\n');
    throw new Error(`RAML inválido. Corrija antes de comparar contrato.\n${details}`);
  }

  const apiJson = api.toJSON({ serializeMetadata: false });
  const endpoints = [];

  function walkResources(resources) {
    for (const resource of resources || []) {
      const fullPath = String(resource.completeRelativeUri());
      const resourceJson = resource.toJSON({ serializeMetadata: false });
      const uriParameters = normalizeParameters(resourceJson.uriParameters);

      for (const method of resource.methods ? resource.methods() : []) {
        const methodJson = method.toJSON({ serializeMetadata: false });
        const endpoint = normalizeMethod(methodJson, fullPath);
        endpoint.uriParameters = uriParameters;
        endpoints.push(endpoint);
      }

      if (resource.resources) walkResources(resource.resources());
    }
  }

  walkResources(api.resources ? api.resources() : []);
  endpoints.sort((a, b) => a.id.localeCompare(b.id));

  return {
    contractVersion: '1.0',
    sourceFile: file,
    generatedAt: new Date().toISOString(),
    title: apiJson.title || null,
    version: apiJson.version || null,
    baseUri: apiJson.baseUri || null,
    protocols: asArray(apiJson.protocols).map(String).sort(),
    securitySchemes: normalizeSecuritySchemes(apiJson),
    traits: normalizeTraits(apiJson),
    endpoints,
    types: normalizeTypes(apiJson)
  };
}

function loadBreakingChanges() {
  if (!fs.existsSync(BREAKING_CHANGES_FILE)) {
    return {
      approved: false,
      ticket: null,
      approvedBy: null,
      reason: null,
      removedEndpoints: [],
      approvedRules: [],
      allowAllBreakingChanges: false
    };
  }

  const raw = fs.readFileSync(BREAKING_CHANGES_FILE, 'utf-8');
  const parsed = YAML.parse(raw) || {};
  const cfg = parsed.breakingChanges || parsed || {};

  return {
    approved: Boolean(cfg.approved),
    ticket: cfg.ticket || null,
    approvedBy: cfg.approvedBy || null,
    reason: cfg.reason || null,
    removedEndpoints: Array.isArray(cfg.removedEndpoints) ? cfg.removedEndpoints : [],
    approvedRules: Array.isArray(cfg.approvedRules) ? cfg.approvedRules.map(String) : [],
    allowAllBreakingChanges: Boolean(cfg.allowAllBreakingChanges)
  };
}

function approvalHasMinimumData(approval) {
  return Boolean(approval.approved && approval.ticket && approval.approvedBy && approval.reason);
}

function isRemovedEndpointApproved(approval, endpoint) {
  if (!approvalHasMinimumData(approval)) return false;
  return approval.removedEndpoints.some((item) => {
    return String(item.method || '').toUpperCase() === endpoint.method && String(item.path || '') === endpoint.path;
  });
}

function isRuleApproved(approval, ruleId) {
  if (!approvalHasMinimumData(approval)) return false;
  if (approval.allowAllBreakingChanges) return true;
  return approval.approvedRules.includes(ruleId);
}

function arrayDiff(base = [], current = []) {
  const currentSet = new Set(current);
  return base.filter((item) => !currentSet.has(item));
}

function sameType(a = [], b = []) {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

function indexEndpoints(contract) {
  const map = new Map();
  for (const endpoint of contract.endpoints || []) map.set(endpoint.id, endpoint);
  return map;
}

function addFinding(diff, severity, ruleId, message, details = {}) {
  diff.findings.push({ severity, ruleId, message, details });
}

function addBreaking(diff, ruleId, message, details = {}, approval) {
  if (isRuleApproved(approval, ruleId)) {
    addFinding(diff, 'WARN_APPROVED', ruleId, message, {
      ...details,
      approval: {
        ticket: approval.ticket,
        approvedBy: approval.approvedBy,
        reason: approval.reason
      }
    });
  } else {
    addFinding(diff, 'BLOCK', ruleId, message, details);
  }
}

function compareContracts(base, current, approval) {
  const diff = {
    generatedAt: new Date().toISOString(),
    status: 'OK',
    baselineSource: base.source || base.sourceFile || 'unknown',
    currentSource: current.sourceFile || CURRENT_RAML,
    summary: {
      previousEndpoints: (base.endpoints || []).length,
      currentEndpoints: (current.endpoints || []).length,
      addedEndpoints: 0,
      removedEndpoints: 0,
      changedEndpoints: 0,
      blocks: 0,
      warnings: 0,
      approvedWarnings: 0
    },
    addedEndpoints: [],
    removedEndpoints: [],
    changedEndpoints: [],
    findings: [],
    approval
  };

  const baseEndpoints = indexEndpoints(base);
  const currentEndpoints = indexEndpoints(current);

  for (const endpoint of current.endpoints || []) {
    if (!baseEndpoints.has(endpoint.id)) {
      diff.addedEndpoints.push(endpoint);
      addFinding(diff, 'INFO', `ENDPOINT_ADDED:${endpoint.id}`, `Novo endpoint detectado: ${endpoint.id}`, endpoint);
    }
  }

  for (const endpoint of base.endpoints || []) {
    if (!currentEndpoints.has(endpoint.id)) {
      diff.removedEndpoints.push(endpoint);
      diff.summary.removedEndpoints += 1;

      if (isRemovedEndpointApproved(approval, endpoint)) {
        addFinding(diff, 'WARN_APPROVED', `ENDPOINT_REMOVED:${endpoint.id}`, `Endpoint removido com aprovação explícita: ${endpoint.id}`, {
          endpoint,
          approval: {
            ticket: approval.ticket,
            approvedBy: approval.approvedBy,
            reason: approval.reason
          }
        });
      } else {
        addFinding(diff, 'BLOCK', `ENDPOINT_REMOVED:${endpoint.id}`, `Endpoint removido sem aprovação: ${endpoint.id}`, endpoint);
      }
    }
  }

  for (const [id, before] of baseEndpoints.entries()) {
    if (!currentEndpoints.has(id)) continue;

    const after = currentEndpoints.get(id);
    const endpointChanges = [];

    for (const scheme of before.securedBy || []) {
      if (!(after.securedBy || []).includes(scheme)) {
        const ruleId = `SECURITY_REMOVED:${id}:${scheme}`;
        endpointChanges.push({ ruleId, type: 'security_removed', scheme });
        addBreaking(diff, ruleId, `Security scheme removido do endpoint ${id}: ${scheme}`, { endpoint: id, scheme }, approval);
      }
    }

    for (const trait of before.traits || []) {
      if (!(after.traits || []).includes(trait)) {
        const ruleId = `TRAIT_REMOVED:${id}:${trait}`;
        endpointChanges.push({ ruleId, type: 'trait_removed', trait });
        addBreaking(diff, ruleId, `Trait removida do endpoint ${id}: ${trait}`, { endpoint: id, trait }, approval);
      }
    }

    for (const [paramName, param] of Object.entries(before.uriParameters || {})) {
      const next = (after.uriParameters || {})[paramName];
      if (!next) {
        const ruleId = `URI_PARAM_REMOVED:${id}:${paramName}`;
        endpointChanges.push({ ruleId, type: 'uri_param_removed', paramName });
        addBreaking(diff, ruleId, `URI param removido do endpoint ${id}: ${paramName}`, { endpoint: id, paramName }, approval);
        continue;
      }

      if (!sameType(param.type, next.type)) {
        const ruleId = `URI_PARAM_TYPE_CHANGED:${id}:${paramName}`;
        endpointChanges.push({ ruleId, type: 'uri_param_type_changed', paramName, from: param.type, to: next.type });
        addBreaking(diff, ruleId, `Tipo de URI param alterado no endpoint ${id}: ${paramName}`, { endpoint: id, paramName, from: param.type, to: next.type }, approval);
      }
    }

    for (const [paramName, param] of Object.entries(before.queryParameters || {})) {
      const next = (after.queryParameters || {})[paramName];
      if (!next) {
        const severity = param.required ? 'BLOCK' : 'WARN';
        const ruleId = `QUERY_PARAM_REMOVED:${id}:${paramName}`;
        endpointChanges.push({ ruleId, type: 'query_param_removed', paramName, required: param.required });

        if (severity === 'BLOCK') {
          addBreaking(diff, ruleId, `Query param obrigatório removido do endpoint ${id}: ${paramName}`, { endpoint: id, paramName }, approval);
        } else {
          addFinding(diff, 'WARN', ruleId, `Query param opcional removido do endpoint ${id}: ${paramName}`, { endpoint: id, paramName });
        }
        continue;
      }

      if (!sameType(param.type, next.type)) {
        const ruleId = `QUERY_PARAM_TYPE_CHANGED:${id}:${paramName}`;
        endpointChanges.push({ ruleId, type: 'query_param_type_changed', paramName, from: param.type, to: next.type });
        addBreaking(diff, ruleId, `Tipo de query param alterado no endpoint ${id}: ${paramName}`, { endpoint: id, paramName, from: param.type, to: next.type }, approval);
      }
    }

    for (const code of ['200', '201']) {
      if ((before.responses || {})[code] && !(after.responses || {})[code]) {
        const ruleId = `RESPONSE_REMOVED:${id}:${code}`;
        endpointChanges.push({ ruleId, type: 'response_removed', code });
        addBreaking(diff, ruleId, `Response ${code} removida do endpoint ${id}`, { endpoint: id, code }, approval);
      }
    }

    for (const [mediaType, body] of Object.entries(before.body || {})) {
      const next = (after.body || {})[mediaType];
      if (!next) {
        const ruleId = `REQUEST_BODY_REMOVED:${id}:${mediaType}`;
        endpointChanges.push({ ruleId, type: 'request_body_removed', mediaType });
        addBreaking(diff, ruleId, `Request body removido do endpoint ${id}: ${mediaType}`, { endpoint: id, mediaType }, approval);
        continue;
      }

      if (!sameType(body.type, next.type)) {
        const ruleId = `REQUEST_BODY_TYPE_CHANGED:${id}:${mediaType}`;
        endpointChanges.push({ ruleId, type: 'request_body_type_changed', mediaType, from: body.type, to: next.type });
        addBreaking(diff, ruleId, `Tipo de request body alterado no endpoint ${id}: ${mediaType}`, { endpoint: id, mediaType, from: body.type, to: next.type }, approval);
      }
    }

    if (endpointChanges.length) {
      diff.changedEndpoints.push({ id, method: before.method, path: before.path, changes: endpointChanges });
    }
  }

  for (const scheme of base.securitySchemes || []) {
    if (!(current.securitySchemes || []).includes(scheme)) {
      const ruleId = `GLOBAL_SECURITY_SCHEME_REMOVED:${scheme}`;
      addBreaking(diff, ruleId, `Security scheme global removido: ${scheme}`, { scheme }, approval);
    }
  }

  for (const trait of base.traits || []) {
    if (!(current.traits || []).includes(trait)) {
      const ruleId = `GLOBAL_TRAIT_REMOVED:${trait}`;
      addBreaking(diff, ruleId, `Trait global removida: ${trait}`, { trait }, approval);
    }
  }

  for (const [typeName, beforeType] of Object.entries(base.types || {})) {
    const afterType = (current.types || {})[typeName];
    if (!afterType) {
      const ruleId = `TYPE_REMOVED:${typeName}`;
      addBreaking(diff, ruleId, `Type/schema removido: ${typeName}`, { typeName }, approval);
      continue;
    }

    for (const [propertyPath, beforeProperty] of Object.entries(beforeType.properties || {})) {
      const afterProperty = (afterType.properties || {})[propertyPath];
      if (!afterProperty && beforeProperty.required) {
        const ruleId = `REQUIRED_FIELD_REMOVED:${typeName}:${propertyPath}`;
        addBreaking(diff, ruleId, `Campo obrigatório removido em ${typeName}: ${propertyPath}`, { typeName, propertyPath }, approval);
        continue;
      }

      if (afterProperty && !sameType(beforeProperty.type, afterProperty.type)) {
        const ruleId = `FIELD_TYPE_CHANGED:${typeName}:${propertyPath}`;
        addBreaking(diff, ruleId, `Tipo de campo alterado em ${typeName}: ${propertyPath}`, {
          typeName,
          propertyPath,
          from: beforeProperty.type,
          to: afterProperty.type
        }, approval);
      }
    }
  }

  diff.summary.addedEndpoints = diff.addedEndpoints.length;
  diff.summary.changedEndpoints = diff.changedEndpoints.length;
  diff.summary.blocks = diff.findings.filter((item) => item.severity === 'BLOCK').length;
  diff.summary.warnings = diff.findings.filter((item) => item.severity === 'WARN').length;
  diff.summary.approvedWarnings = diff.findings.filter((item) => item.severity === 'WARN_APPROVED').length;

  if (diff.summary.blocks > 0) diff.status = 'BLOCKED';
  else if (diff.summary.warnings > 0 || diff.summary.approvedWarnings > 0) diff.status = 'WARNING';
  else diff.status = 'OK';

  return diff;
}

function detectGitBaselineRef() {
  const candidates = [];

  if (process.env.GITHUB_BASE_REF) {
    candidates.push(`origin/${process.env.GITHUB_BASE_REF}:${CURRENT_RAML}`);
    candidates.push(`${process.env.GITHUB_BASE_REF}:${CURRENT_RAML}`);
  }

  if (process.env.SYSTEM_PULLREQUEST_TARGETBRANCH) {
    const target = process.env.SYSTEM_PULLREQUEST_TARGETBRANCH.replace(/^refs\/heads\//, '');
    candidates.push(`origin/${target}:${CURRENT_RAML}`);
    candidates.push(`${target}:${CURRENT_RAML}`);
  }

  candidates.push(`HEAD^:${CURRENT_RAML}`);
  candidates.push(`HEAD~1:${CURRENT_RAML}`);

  return candidates;
}

async function loadStaticBaselineContract() {
  fs.mkdirSync(DIST_DIR, { recursive: true });
  if (fs.existsSync(STATIC_BASELINE_FILE)) {
    const contract = JSON.parse(fs.readFileSync(STATIC_BASELINE_FILE, 'utf-8'));
    contract.source = STATIC_BASELINE_FILE;
    return contract;
  }
  return null;
}

async function loadGitBaseContract() {
  const gitBaseFile = process.env.API_CONTRACT_GIT_BASE || path.join(DIST_DIR, 'api-contract-git-base.json');
  if (fs.existsSync(gitBaseFile)) {
    try {
      const contract = JSON.parse(fs.readFileSync(gitBaseFile, 'utf-8'));
      if (contract.status === 'SKIPPED') return null;
      contract.source = contract.source || gitBaseFile;
      return contract;
    } catch (_) {}
  }

  for (const ref of detectGitBaselineRef()) {
    const result = run('git', ['show', ref]);
    if (result.status === 0 && result.stdout.trim()) {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-raml-'));
      const tempRaml = path.join(tempDir, path.basename(CURRENT_RAML));
      fs.writeFileSync(tempRaml, result.stdout, 'utf-8');

      try {
        const contract = await extractContract(tempRaml);
        contract.source = `git:${ref}`;
        return contract;
      } catch (error) {
        console.warn(`⚠️ Não foi possível extrair contrato de ${ref}: ${error.message}`);
      }
    }
  }

  return null;
}

function createMissingBaselineDiff(current) {
  return {
    generatedAt: new Date().toISOString(),
    status: 'WARNING',
    baselineSource: 'none',
    currentSource: CURRENT_RAML,
    summary: {
      previousEndpoints: 0,
      currentEndpoints: current.endpoints.length,
      addedEndpoints: current.endpoints.length,
      removedEndpoints: 0,
      changedEndpoints: 0,
      blocks: 0,
      warnings: 1,
      approvedWarnings: 0
    },
    addedEndpoints: current.endpoints,
    removedEndpoints: [],
    changedEndpoints: [],
    findings: [
      {
        severity: 'WARN',
        ruleId: 'BASELINE_NOT_FOUND',
        message: 'Baseline stable não encontrado. Esta execução será usada apenas como inventário inicial.',
        details: {}
      }
    ],
    approval: loadBreakingChanges()
  };
}

function toGuardSummary(name, diff, source) {
  if (!diff) {
    return {
      name,
      status: 'SKIPPED',
      source: source || 'not-found',
      summary: {},
      removedEndpoints: [],
      addedEndpoints: [],
      changedEndpoints: [],
      findings: []
    };
  }
  return {
    name,
    status: diff.status,
    source: source || diff.baselineSource,
    summary: diff.summary,
    removedEndpoints: diff.removedEndpoints || [],
    addedEndpoints: diff.addedEndpoints || [],
    changedEndpoints: diff.changedEndpoints || [],
    findings: diff.findings || []
  };
}

function mergeFinalDecision(stableDiff, gitDiff) {
  const stableStatus = stableDiff?.status || 'WARNING';
  const gitStatus = gitDiff?.status || 'SKIPPED';

  if (stableStatus === 'BLOCKED' || gitStatus === 'BLOCKED') {
    return {
      status: 'BLOCKED',
      canPublishExchange: false,
      reason: stableStatus === 'BLOCKED'
        ? 'Stable Baseline Guard bloqueou a publicação.'
        : 'Git Diff Guard detectou breaking change crítica nesta alteração.'
    };
  }

  if (stableStatus === 'WARNING' || gitStatus === 'WARNING' || gitStatus === 'SKIPPED') {
    return {
      status: 'WARNING',
      canPublishExchange: true,
      reason: gitStatus === 'SKIPPED'
        ? 'Git Diff Guard não foi executado; Stable Baseline Guard permaneceu como fonte oficial.'
        : 'Existem warnings aprovados ou não críticos.'
    };
  }

  return { status: 'OK', canPublishExchange: true, reason: 'Contrato aprovado.' };
}

function writeMarkdown(diff) {
  const lines = [
    '# Release Flow Guardian — API Contract Guard',
    '',
    `- **Status:** ${diff.status}`,
    `- **Baseline:** ${diff.baselineSource}`,
    `- **Current:** ${diff.currentSource}`,
    `- **Previous endpoints:** ${diff.summary.previousEndpoints}`,
    `- **Current endpoints:** ${diff.summary.currentEndpoints}`,
    `- **Added endpoints:** ${diff.summary.addedEndpoints}`,
    `- **Removed endpoints:** ${diff.summary.removedEndpoints}`,
    `- **Changed endpoints:** ${diff.summary.changedEndpoints}`,
    `- **Blocks:** ${diff.summary.blocks}`,
    `- **Warnings:** ${diff.summary.warnings}`,
    `- **Approved warnings:** ${diff.summary.approvedWarnings}`,
    '',
    '## Added endpoints',
    '',
    ...(diff.addedEndpoints.length ? diff.addedEndpoints.map((item) => `- + ${item.id}`) : ['- Nenhum endpoint novo.']),
    '',
    '## Removed endpoints',
    '',
    ...(diff.removedEndpoints.length ? diff.removedEndpoints.map((item) => `- - ${item.id}`) : ['- Nenhum endpoint removido.']),
    '',
    '## Findings',
    '',
    ...(diff.findings.length
      ? diff.findings.map((item) => `- [${item.severity}] ${item.message} (${item.ruleId})`)
      : ['- Nenhum finding.']),
    ''
  ];

  fs.writeFileSync(DIFF_MD, lines.join('\n'), 'utf-8');
}

async function main() {
  console.log('================================================================================');
  console.log('API CONTRACT GUARD');
  console.log('================================================================================');

  const current = await extractContract(CURRENT_RAML);
  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(CURRENT_CONTRACT, JSON.stringify(current, null, 2), 'utf-8');

  const approval = loadBreakingChanges();
  const stableBaseline = await loadStaticBaselineContract();
  let stableDiff;

  if (!stableBaseline) {
    stableDiff = createMissingBaselineDiff(current);
    fs.writeFileSync(BASELINE_USED, JSON.stringify({ endpoints: [], types: {}, source: 'none' }, null, 2), 'utf-8');
  } else {
    fs.writeFileSync(BASELINE_USED, JSON.stringify(stableBaseline, null, 2), 'utf-8');
    stableDiff = compareContracts(stableBaseline, current, approval);
    stableDiff.baselineSource = stableBaseline.source || STATIC_BASELINE_FILE;
  }

  const gitBase = await loadGitBaseContract();
  let gitDiff = null;
  if (gitBase) {
    gitDiff = compareContracts(gitBase, current, approval);
    gitDiff.baselineSource = gitBase.source || 'git-base';
  }

  const finalDecision = mergeFinalDecision(stableDiff, gitDiff);
  const diff = {
    ...stableDiff,
    status: finalDecision.status,
    stableBaselineGuard: toGuardSummary('Stable Baseline Guard', stableDiff, stableDiff.baselineSource || STATIC_BASELINE_FILE),
    gitDiffGuard: toGuardSummary('Git Diff Guard', gitDiff, gitBase?.source || 'SKIPPED'),
    finalDecision,
    sourcePriority: ['stable-baseline', 'git-diff']
  };

  fs.writeFileSync(DIFF_JSON, JSON.stringify(diff, null, 2), 'utf-8');
  writeMarkdown(diff);

  console.log(`Stable Baseline Guard: ${diff.stableBaselineGuard.status}`);
  console.log(`Git Diff Guard:        ${diff.gitDiffGuard.status}`);
  console.log(`Final decision:        ${diff.finalDecision.status}`);
  console.log(`Can publish Exchange:  ${diff.finalDecision.canPublishExchange}`);
  console.log(`Endpoints baseline:    ${diff.summary.previousEndpoints || 0}`);
  console.log(`Endpoints atuais:      ${diff.summary.currentEndpoints || 0}`);
  console.log(`Blocks:                ${diff.summary.blocks || 0}`);
  console.log(`Warnings:              ${diff.summary.warnings || 0}`);

  if (diff.finalDecision.status === 'BLOCKED') {
    console.error('❌ API Contract Guard bloqueou a release. Veja dist/api-contract-diff.md');
    process.exit(1);
  }

  if (diff.finalDecision.status === 'WARNING') {
    console.warn('⚠️ API Contract Guard passou com warning. Veja dist/api-contract-diff.md');
    return;
  }

  console.log('✅ API Contract Guard aprovado sem breaking changes.');
}

main().catch((error) => {
  console.error('❌ Falha inesperada no API Contract Guard:');
  console.error(error.stack || error.message || error);
  process.exit(1);
});
