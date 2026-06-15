#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const YAML = require('yaml');

const coreRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const parsed = { command: null, options: {}, positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      parsed.command = 'help';
      continue;
    }
    if (arg === '--version' || arg === '-v') {
      parsed.command = 'version';
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        parsed.options[key] = next;
        i += 1;
      } else {
        parsed.options[key] = true;
      }
      continue;
    }
    if (!parsed.command) parsed.command = arg;
    else parsed.positional.push(arg);
  }
  parsed.command = parsed.command || 'help';
  return parsed;
}

const parsed = parseArgs(process.argv.slice(2));

function normalizeProjectDir(input) {
  const candidate = input || process.env.GUARDIAN_PROJECT_DIR || process.cwd();
  return path.resolve(candidate);
}

const projectRoot = normalizeProjectDir(parsed.options.project);
const configPathInput = parsed.options.config || process.env.GUARDIAN_CONFIG || 'release/guardian.config.yml';
const configPath = path.isAbsolute(configPathInput) ? configPathInput : path.join(projectRoot, configPathInput);

process.env.GUARDIAN_PROJECT_DIR = projectRoot;
process.env.GUARDIAN_CORE_ROOT = coreRoot;
process.env.GUARDIAN_CONFIG = configPath;

try {
  if (fs.existsSync(projectRoot)) process.chdir(projectRoot);
} catch (error) {
  console.error(`❌ Não foi possível acessar o projeto informado: ${projectRoot}`);
  console.error(error.message);
  process.exit(1);
}

function readConfig() {
  if (!fs.existsSync(configPath)) return {};
  try {
    return YAML.parse(fs.readFileSync(configPath, 'utf8')) || {};
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
    RELEASE_MANIFEST: config.release?.manifestFile || 'release/release-manifest.yml',
    BREAKING_CHANGES_FILE: config.contractGuard?.breakingChangesFile || 'release/breaking-changes.yml',
    API_CONTRACT_BASELINE_FILE: config.contractGuard?.baselineFile || 'release/api-contract-baseline.json',
    API_CONTRACT_CURRENT: config.contractGuard?.currentContractFile || 'dist/api-contract-current.json',
    EXCHANGE_ASSET_ID: exchange.assetId,
    EXCHANGE_ASSET_NAME: exchange.assetName,
    EXCHANGE_ASSET_DESCRIPTION: exchange.assetDescription,
    EXCHANGE_MINOR_VERSION: versioning.minorLine,
    EXCHANGE_INITIAL_VERSION: versioning.initialVersion,
    API_VERSION: exchange.apiVersion || 'v1',
    EXCHANGE_MAX_CONFLICT_BUMPS: autoBump.max409Retries,
    EXCHANGE_MAX_TRANSIENT_RETRIES: autoBump.retry5xxMaxAttempts,
    EXCHANGE_ZIP: exchange.assetId ? `dist/${exchange.assetId}-exchange.zip` : undefined
  };

  for (const [key, value] of Object.entries(envMap)) {
    if (value !== undefined && value !== null && String(value).trim() !== '' && !process.env[key]) {
      process.env[key] = String(value);
    }
  }

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

function scriptPath(script) {
  return path.join(coreRoot, 'scripts', script);
}

function runNode(script, args = [], opts = {}) {
  const fullScript = scriptPath(script);
  const result = spawnSync(process.execPath, [fullScript, ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, GUARDIAN_PROJECT_DIR: projectRoot, GUARDIAN_CORE_ROOT: coreRoot, GUARDIAN_CONFIG: configPath },
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
    env: { ...process.env, GUARDIAN_PROJECT_DIR: projectRoot, GUARDIAN_CORE_ROOT: coreRoot, GUARDIAN_CONFIG: configPath },
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

function showHelp() {
  console.log(`\nRelease Flow Guardian Core\n\nUsage:\n  release-flow-guardian <command> [--project <path>] [--config <path>]\n\nExamples:\n  release-flow-guardian validate --project "C:\\repos\\mule-tlf-com-test"\n  release-flow-guardian preflight --project "C:\\repos\\mule-tlf-com-test"\n  release-flow-guardian console --project "C:\\repos\\mule-tlf-com-test"\n\nCommands:\n  deps:check\n  validate:config\n  validate:release\n  validate:raml\n  stability:resolve\n  contract:extract\n  contract:extract:git-base\n  contract:guard\n  package:exchange\n  publish:exchange\n  report:html\n  validate\n  preflight\n  ci:publish\n  config:ui | console\n  version\n\nExpected consumer project files:\n  api.raml\n  release/guardian.config.yml\n  release/api-contract-baseline.json\n  release/breaking-changes.yml\n  release/release-manifest.yml\n\nProject loaded:\n  ${projectRoot}\nCore loaded:\n  ${coreRoot}\nConfig path:\n  ${configPath}\n`);
}

function showVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(coreRoot, 'package.json'), 'utf8'));
    console.log(`${pkg.name}@${pkg.version}`);
  } catch {
    console.log('release-flow-guardian-core');
  }
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
    case 'contract:extract:git-base':
      runNode('extract-git-base-contract.js', [mainFile, 'dist/api-contract-git-base.json']);
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
    case 'history':
      runNode('print-history.js');
      break;
    case 'history:summary':
      runNode('print-history.js', ['--summary']);
      break;
    case 'config:ui':
    case 'console':
      runConsole();
      break;
    case 'validate':
      runMany(['deps:check', 'validate:config', 'validate:release', 'validate:raml', 'stability:resolve', 'contract:extract', 'contract:extract:git-base', 'contract:guard']);
      break;
    case 'preflight':
      runMany(['validate', 'package:exchange', 'report:html']);
      break;
    case 'ci:publish':
      runMany(['validate', 'package:exchange', 'publish:exchange', 'report:html']);
      break;
    case 'version':
      showVersion();
      break;
    case 'help':
      showHelp();
      break;
    default:
      showHelp();
      process.exit(1);
  }
}

applyConfigToEnv();
runCommand(parsed.command);
