const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const CONFIG_PATH = process.env.GUARDIAN_CONFIG || 'release/guardian.config.yml';

function readYamlFile(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath, 'utf8');
  return YAML.parse(raw) || fallback;
}

function writeYamlFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, YAML.stringify(data), 'utf8');
}

function loadConfig() {
  return readYamlFile(CONFIG_PATH, {});
}

function timestamp() {
  const d = new Date();
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const parsed = path.parse(filePath);
  const backupDir = path.join('release', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${parsed.name}.${timestamp()}${parsed.ext}`);
  fs.copyFileSync(filePath, backupPath);
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
  CONFIG_PATH,
  readYamlFile,
  writeYamlFile,
  loadConfig,
  backupFile,
  getBranchName,
  resolveStability
};
