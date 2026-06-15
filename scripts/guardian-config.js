const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const PROJECT_DIR = path.resolve(process.env.GUARDIAN_PROJECT_DIR || process.cwd());
const CORE_DIR = path.resolve(process.env.GUARDIAN_CORE_ROOT || path.join(__dirname, '..'));
const CONFIG_PATH_INPUT = process.env.GUARDIAN_CONFIG || 'release/guardian.config.yml';
const CONFIG_PATH = path.isAbsolute(CONFIG_PATH_INPUT) ? CONFIG_PATH_INPUT : path.join(PROJECT_DIR, CONFIG_PATH_INPUT);

function resolveProjectPath(filePath) {
  if (!filePath) return filePath;
  return path.isAbsolute(filePath) ? filePath : path.join(PROJECT_DIR, filePath);
}

function readYamlFile(filePath, fallback = {}) {
  const fullPath = resolveProjectPath(filePath);
  if (!fs.existsSync(fullPath)) return fallback;
  const raw = fs.readFileSync(fullPath, 'utf8');
  return YAML.parse(raw) || fallback;
}

function writeYamlFile(filePath, data) {
  const fullPath = resolveProjectPath(filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, YAML.stringify(data), 'utf8');
}

function loadConfig() {
  return readYamlFile(CONFIG_PATH, {});
}

function timestamp() {
  const d = new Date();
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function backupFile(filePath) {
  const fullPath = resolveProjectPath(filePath);
  if (!fs.existsSync(fullPath)) return null;
  const parsed = path.parse(fullPath);
  const backupDir = path.join(PROJECT_DIR, 'release', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${parsed.name}.${timestamp()}${parsed.ext}`);
  fs.copyFileSync(fullPath, backupPath);
  return backupPath;
}

function getBranchName() {
  const azureFull = process.env.BUILD_SOURCEBRANCH || '';
  const githubRef = process.env.GITHUB_REF || '';
  return (
    process.env.GITHUB_HEAD_REF ||
    process.env.GITHUB_REF_NAME ||
    process.env.BUILD_SOURCEBRANCHNAME ||
    process.env.BRANCH_NAME ||
    azureFull.replace(/^refs\/heads\//, '') ||
    githubRef.replace(/^refs\/heads\//, '') ||
    'local'
  );
}

function wildcardMatch(pattern, value) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

function resolveStability(config, branch = getBranchName()) {
  const versioning = config.versioning || {};
  const stability = versioning.stability || {};
  const allowed = stability.allowed || ['draft', 'beta', 'rc', 'stable', 'deprecated'];
  const branchRules = versioning.branchRules || {};
  let resolved = stability.default || 'draft';
  let matchedRule = 'default';

  for (const [pattern, status] of Object.entries(branchRules)) {
    if (pattern === branch || wildcardMatch(pattern, branch)) {
      resolved = status;
      matchedRule = pattern;
      break;
    }
  }

  if (!allowed.includes(resolved)) resolved = stability.default || 'draft';

  return {
    branch,
    stability: resolved,
    matchedRule,
    allowed,
    baselineUpdateAllowed: resolved === 'stable' && Boolean((config.baseline || {}).updateOnStable !== false),
    publishAllowed: true
  };
}

module.exports = {
  PROJECT_DIR,
  CORE_DIR,
  CONFIG_PATH,
  resolveProjectPath,
  readYamlFile,
  writeYamlFile,
  loadConfig,
  backupFile,
  getBranchName,
  resolveStability
};
