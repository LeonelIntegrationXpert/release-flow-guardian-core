#!/usr/bin/env node
const fs = require('fs');
const { loadConfig, CONFIG_PATH, resolveProjectPath } = require('./guardian-config');
const { OPTIONS } = require('../config/guardian-config-ui.schema');

const requiredSecrets = [
  'ANYPOINT_CONNECTED_APP_CLIENT_ID',
  'ANYPOINT_CONNECTED_APP_CLIENT_SECRET',
  'ANYPOINT_ORG',
  'ANYPOINT_HOST',
  'EXCHANGE_GROUP_ID'
];

const checks = [];
function check(condition, message, details = '') {
  checks.push({ status: condition ? 'OK' : 'BLOCK', message, details });
  console.log(`${condition ? '✅' : '❌'} ${message}${details ? ` — ${details}` : ''}`);
}

function isVersion(value) { return /^\d+\.\d+\.\d+$/.test(String(value || '')); }
function isMinor(value) { return /^\d+\.\d+$/.test(String(value || '')); }
function isBool(value) { return typeof value === 'boolean'; }
function inList(value, list) { return list.includes(String(value || '')); }
function isNumberBetween(value, min, max) { const n = Number(value); return Number.isFinite(n) && n >= min && n <= max; }
function decision(value) { return ['ok', 'warn', 'block'].includes(String(value || '')); }

function main() {
  console.log('================================================================================');
  console.log('RELEASE FLOW GUARDIAN — CONFIG VALIDATION');
  console.log('================================================================================');

  check(fs.existsSync(CONFIG_PATH), `Arquivo de configuração existe: ${CONFIG_PATH}`);
  const config = loadConfig();

  check(Boolean(config.project?.name), 'project.name preenchido');
  check(Boolean(config.project?.mainFile), 'project.mainFile preenchido');
  check(config.project?.mainFile && fs.existsSync(resolveProjectPath(config.project.mainFile)), 'project.mainFile existe no repositório', config.project?.mainFile || '');
  check(Boolean(config.exchange?.assetId), 'exchange.assetId preenchido');
  check(Boolean(config.exchange?.assetName), 'exchange.assetName preenchido');
  check(inList(config.exchange?.classifier, OPTIONS.classifier), 'exchange.classifier permitido', config.exchange?.classifier || 'vazio');
  check(inList(config.exchange?.apiVersion, OPTIONS.apiVersion), 'exchange.apiVersion sugerido/permitido', config.exchange?.apiVersion || 'vazio');
  check(isMinor(config.versioning?.minorLine), 'versioning.minorLine no formato x.y', config.versioning?.minorLine || 'vazio');
  check(isVersion(config.versioning?.initialVersion), 'versioning.initialVersion no formato x.y.z', config.versioning?.initialVersion || 'vazio');
  check(inList(config.versioning?.strategy, OPTIONS.versioningStrategy), 'versioning.strategy permitido', config.versioning?.strategy || 'vazio');

  const allowed = config.versioning?.stability?.allowed || [];
  const def = config.versioning?.stability?.default;
  check(Array.isArray(allowed) && allowed.length > 0, 'versioning.stability.allowed preenchido');
  check(allowed.includes(def), 'versioning.stability.default está em allowed', def || 'vazio');
  check(inList(config.contractGuard?.baselineMode, OPTIONS.baselineMode.map(o => o.value || o)), 'contractGuard.baselineMode permitido', config.contractGuard?.baselineMode || 'vazio');

  check(Boolean(config.contractGuard?.baselineFile), 'contractGuard.baselineFile informado');
  check(Boolean(config.contractGuard?.breakingChangesFile), 'contractGuard.breakingChangesFile informado');
  if (config.contractGuard?.baselineFile) check(fs.existsSync(resolveProjectPath(config.contractGuard.baselineFile)), 'baselineFile existe', config.contractGuard.baselineFile);
  if (config.contractGuard?.breakingChangesFile) check(fs.existsSync(resolveProjectPath(config.contractGuard.breakingChangesFile)), 'breakingChangesFile existe', config.contractGuard.breakingChangesFile);
  check(Boolean(config.reports?.outputDir), 'reports.outputDir informado');
  check(inList(config.reports?.style, OPTIONS.reportStyle), 'reports.style permitido', config.reports?.style || 'vazio');

  const cd = config.contractGuard?.changeDetection || {};
  check(isNumberBetween(cd.similarityThreshold, 0, 100), 'similarityThreshold entre 0 e 100', String(cd.similarityThreshold));
  check(isNumberBetween(cd.strongSimilarityThreshold, 0, 100), 'strongSimilarityThreshold entre 0 e 100', String(cd.strongSimilarityThreshold));
  check(Number(cd.strongSimilarityThreshold) >= Number(cd.similarityThreshold), 'strongSimilarityThreshold >= similarityThreshold', `${cd.strongSimilarityThreshold} >= ${cd.similarityThreshold}`);
  for (const key of ['sameMethodWeight','pathSimilarityWeight','sameFirstSegmentWeight','sameVersionWeight','uriParamsSimilarityWeight','queryParamsSimilarityWeight','responsesSimilarityWeight']) {
    check(Number(cd[key]) >= 0, `${key} é número >= 0`, String(cd[key]));
  }

  const db = config.contractGuard?.defaultBehavior || {};
  for (const key of ['newEndpoint','removedEndpoint','possibleReplacement','replacedEndpointWithoutApproval','changedBreakingEndpoint','changedNonBreakingEndpoint','approvedBreakingChange']) {
    check(decision(db[key]), `defaultBehavior.${key} em ok/warn/block`, String(db[key]));
  }

  for (const key of ['enabled','blockRemovedEndpoints','blockRemovedMethods','blockRemovedRequiredQueryParams','blockRemovedUriParams','blockRemovedSuccessResponses','blockRemovedSecurity','blockRemovedTraits','allowApprovedBreakingChanges']) {
    check(isBool(config.contractGuard?.[key]), `contractGuard.${key} é boolean`, String(config.contractGuard?.[key]));
  }

  const configuredSecrets = config.security?.requiredSecrets || [];
  for (const secret of requiredSecrets) {
    check(configuredSecrets.includes(secret), `secret obrigatório configurado: ${secret}`);
  }

  const max409 = config.exchange?.autoBump?.max409Retries;
  check(Number.isInteger(Number(max409)) && Number(max409) >= 0, 'exchange.autoBump.max409Retries é número >= 0', String(max409));

  const blockers = checks.filter((item) => item.status === 'BLOCK');
  if (blockers.length) {
    console.error(`\n❌ Configuração inválida. Blockers: ${blockers.length}`);
    process.exit(1);
  }

  console.log('\n✅ guardian.config.yml válido. Defaults recomendados aplicados quando campos estavam ausentes.');
}

main();
