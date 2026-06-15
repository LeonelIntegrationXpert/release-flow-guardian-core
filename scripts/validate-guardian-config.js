#!/usr/bin/env node
const fs = require('fs');
const { loadConfig, CONFIG_PATH } = require('./guardian-config');

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

function main() {
  console.log('================================================================================');
  console.log('RELEASE FLOW GUARDIAN — CONFIG VALIDATION');
  console.log('================================================================================');

  check(fs.existsSync(CONFIG_PATH), `Arquivo de configuração existe: ${CONFIG_PATH}`);
  const config = loadConfig();

  check(Boolean(config.project?.name), 'project.name preenchido');
  check(Boolean(config.project?.mainFile), 'project.mainFile preenchido');
  check(config.project?.mainFile && fs.existsSync(config.project.mainFile), 'project.mainFile existe no repositório', config.project?.mainFile || '');
  check(Boolean(config.exchange?.assetId), 'exchange.assetId preenchido');
  check(Boolean(config.exchange?.assetName), 'exchange.assetName preenchido');
  check(config.exchange?.classifier === 'raml', 'exchange.classifier é raml', config.exchange?.classifier || 'vazio');
  check(isMinor(config.versioning?.minorLine), 'versioning.minorLine no formato x.y', config.versioning?.minorLine || 'vazio');
  check(isVersion(config.versioning?.initialVersion), 'versioning.initialVersion no formato x.y.z', config.versioning?.initialVersion || 'vazio');

  const allowed = config.versioning?.stability?.allowed || [];
  const def = config.versioning?.stability?.default;
  check(Array.isArray(allowed) && allowed.length > 0, 'versioning.stability.allowed preenchido');
  check(allowed.includes(def), 'versioning.stability.default está em allowed', def || 'vazio');

  check(Boolean(config.contractGuard?.baselineFile), 'contractGuard.baselineFile informado');
  check(Boolean(config.contractGuard?.breakingChangesFile), 'contractGuard.breakingChangesFile informado');
  check(Boolean(config.reports?.outputDir), 'reports.outputDir informado');

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

  console.log('\n✅ guardian.config.yml válido.');
}

main();
