#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const YAML = require('yaml');

const coreRoot = path.resolve(__dirname, '..');
const projectRoot = process.cwd();
const configPath = process.env.GUARDIAN_CONFIG || 'release/guardian.config.yml';

function readConfig() {
  const full = path.resolve(projectRoot, configPath);
  if (!fs.existsSync(full)) return {};
  try {
    return YAML.parse(fs.readFileSync(full, 'utf8')) || {};
  } catch (error) {
    console.error(`❌ Falha ao ler ${configPath}: ${error.message}`);
    process.exit(1);
  }
}

function applyConfigToEnv() {
  const config = readConfig();
  const project = config.project || {};
  const exchange = config.exchange || {};
  const versioning = config.versioning || {};
  const autoBump = exchange.autoBump || {};

  const envMap = {
    APP_NAME: project.name,
    API_MAIN_FILE: project.mainFile || exchange.mainFile,
    EXCHANGE_ASSET_ID: exchange.assetId,
    EXCHANGE_ASSET_NAME: exchange.assetName,
    EXCHANGE_ASSET_DESCRIPTION: exchange.assetDescription,
    EXCHANGE_MINOR_VERSION: versioning.minorLine,
    EXCHANGE_INITIAL_VERSION: versioning.initialVersion,
    API_VERSION: exchange.apiVersion,
    EXCHANGE_MAX_CONFLICT_BUMPS: autoBump.max409Retries,
    EXCHANGE_MAX_TRANSIENT_RETRIES: autoBump.retry5xxMaxAttempts,
    EXCHANGE_ZIP: exchange.assetId ? `dist/${exchange.assetId}-exchange.zip` : undefined
  };

  for (const [key, value] of Object.entries(envMap)) {
    if (value !== undefined && value !== null && String(value).trim() !== '' && !process.env[key]) {
      process.env[key] = String(value);
    }
  }

  // Translate project secret env names to the env names expected by the Exchange publisher.
  if (exchange.clientIdEnv && process.env[exchange.clientIdEnv] && !process.env.ANYPOINT_CLIENT_ID) {
    process.env.ANYPOINT_CLIENT_ID = process.env[exchange.clientIdEnv];
  }
  if (exchange.clientSecretEnv && process.env[exchange.clientSecretEnv] && !process.env.ANYPOINT_CLIENT_SECRET) {
    process.env.ANYPOINT_CLIENT_SECRET = process.env[exchange.clientSecretEnv];
  }
  if (exchange.orgEnv && process.env[exchange.orgEnv] && !process.env.ANYPOINT_ORG) {
    process.env.ANYPOINT_ORG = process.env[exchange.orgEnv];
  }
  if (exchange.hostEnv && process.env[exchange.hostEnv] && !process.env.ANYPOINT_HOST) {
    process.env.ANYPOINT_HOST = process.env[exchange.hostEnv];
  }
  if (exchange.groupIdEnv && process.env[exchange.groupIdEnv] && !process.env.EXCHANGE_GROUP_ID) {
    process.env.EXCHANGE_GROUP_ID = process.env[exchange.groupIdEnv];
  }
}

function runNode(script, args = [], opts = {}) {
  const fullScript = path.join(coreRoot, 'scripts', script);
  const result = spawnSync(process.execPath, [fullScript, ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
    shell: false,
    timeout: opts.timeout || 600000
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status);
}

function runConsole() {
  const fullScript = path.join(coreRoot, 'tools', 'config-console', 'server.js');
  const result = spawnSync(process.execPath, [fullScript], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, GUARDIAN_CORE_ROOT: coreRoot },
    shell: false,
    timeout: 0
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  process.exit(result.status || 0);
}

function runMany(steps) {
  for (const step of steps) runCommand(step);
}

function runCommand(command) {
  const config = readConfig();
  const mainFile = process.env.API_MAIN_FILE || config.project?.mainFile || config.exchange?.mainFile || 'api.raml';
  const currentContract = config.contractGuard?.currentContractFile || 'dist/api-contract-current.json';

  switch (command) {
    case 'deps:check':
      runNode('ensure-dependencies.js');
      break;
    case 'validate:config':
      runNode('validate-guardian-config.js');
      break;
    case 'validate:release':
      runNode('check-release-manifest.js');
      break;
    case 'validate:raml':
      runNode('validate-raml.js', [mainFile]);
      break;
    case 'stability:resolve':
      runNode('resolve-stability.js');
      break;
    case 'contract:extract':
      runNode('extract-raml-contract.js', [mainFile, currentContract]);
      break;
    case 'contract:guard':
      runNode('compare-api-contract.js', [mainFile]);
      break;
    case 'package:exchange':
      runNode('build-exchange-package.js');
      break;
    case 'publish:exchange':
      runNode('exchange-publish-guardian.js', [], { timeout: 1200000 });
      break;
    case 'report:html':
      runNode('generate-html-report.js');
      break;
    case 'config:ui':
    case 'console':
      runConsole();
      break;
    case 'validate':
      runMany(['deps:check', 'validate:config', 'validate:release', 'validate:raml', 'stability:resolve', 'contract:extract', 'contract:guard']);
      break;
    case 'preflight':
      runMany(['validate', 'package:exchange', 'report:html']);
      break;
    case 'ci:publish':
      runMany(['validate', 'package:exchange', 'publish:exchange', 'report:html']);
      break;
    case 'help':
    default:
      console.log(`\nRelease Flow Guardian Core\n\nUsage:\n  release-flow-guardian <command>\n\nCommands:\n  deps:check\n  validate:config\n  validate:release\n  validate:raml\n  stability:resolve\n  contract:extract\n  contract:guard\n  package:exchange\n  publish:exchange\n  report:html\n  validate\n  preflight\n  ci:publish\n  config:ui | console\n`);
      if (command && command !== 'help') process.exit(1);
  }
}

applyConfigToEnv();
runCommand(process.argv[2] || 'help');
