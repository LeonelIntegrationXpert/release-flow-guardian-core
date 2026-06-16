const fs = require('fs');
const path = require('path');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeEol(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function detectEol(text) {
  return String(text || '').includes('\r\n') ? '\r\n' : '\n';
}

function splitLines(text) {
  return normalizeEol(text).split('\n');
}

function pathLineRegex(endpointPath) {
  return new RegExp(`^(\\s*)${escapeRegExp(endpointPath)}\\s*:\\s*(?:#.*)?$`);
}

function findPathLine(text, endpointPath) {
  const lines = splitLines(text);
  const matches = [];
  const regex = pathLineRegex(endpointPath);
  lines.forEach((line, index) => {
    const match = line.match(regex);
    if (match) matches.push({ index, indent: match[1] || '', line });
  });
  return { lines, matches };
}

function pathExists(text, endpointPath) {
  return findPathLine(text, endpointPath).matches.length > 0;
}

function extractPathBlock(text, endpointPath) {
  const { lines, matches } = findPathLine(text, endpointPath);
  if (matches.length !== 1) {
    return { ok: false, reason: matches.length === 0 ? 'PATH_NOT_FOUND' : 'AMBIGUOUS_PATH', matches: matches.length };
  }
  const start = matches[0].index;
  const indentLength = matches[0].indent.length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const currentIndent = (line.match(/^\s*/) || [''])[0].length;
    if (currentIndent <= indentLength && /^\s*\/.+:\s*(?:#.*)?$/.test(line)) {
      end = i;
      break;
    }
  }
  return {
    ok: true,
    endpointPath,
    startLine: start + 1,
    endLine: end,
    indent: matches[0].indent,
    block: lines.slice(start, end).join('\n')
  };
}

function replacePath(text, currentPath, baselinePath) {
  const eol = detectEol(text);
  const { lines, matches } = findPathLine(text, currentPath);
  if (matches.length !== 1) {
    return { ok: false, reason: matches.length === 0 ? 'CURRENT_PATH_NOT_FOUND' : 'AMBIGUOUS_CURRENT_PATH', matches: matches.length };
  }
  const existingTarget = findPathLine(text, baselinePath).matches;
  if (existingTarget.length > 0) {
    return { ok: false, reason: 'BASELINE_PATH_ALREADY_EXISTS', matches: existingTarget.length };
  }
  const index = matches[0].index;
  const before = lines.join('\n');
  lines[index] = `${matches[0].indent}${baselinePath}:`;
  const after = lines.join('\n');
  return {
    ok: true,
    restoreType: 'path-restore',
    before: before.replace(/\n/g, eol),
    after: after.replace(/\n/g, eol),
    changedLine: index + 1,
    diff: makeUnifiedDiff(before, after, 'api.raml.before', 'api.raml.after')
  };
}

function insertEndpointBlock(currentText, baselineText, baselinePath) {
  const eol = detectEol(currentText);
  if (pathExists(currentText, baselinePath)) {
    return { ok: false, reason: 'BASELINE_PATH_ALREADY_EXISTS_IN_CURRENT' };
  }
  const extracted = extractPathBlock(baselineText, baselinePath);
  if (!extracted.ok) return extracted;
  const before = normalizeEol(currentText).replace(/\s*$/, '');
  const after = `${before}\n\n${extracted.block}\n`;
  return {
    ok: true,
    restoreType: 'endpoint-block-restore',
    block: extracted.block,
    before: before.replace(/\n/g, eol),
    after: after.replace(/\n/g, eol),
    diff: makeUnifiedDiff(before, after, 'api.raml.before', 'api.raml.after')
  };
}

function makeUnifiedDiff(beforeText, afterText, from = 'before', to = 'after') {
  const before = splitLines(beforeText);
  const after = splitLines(afterText);
  const max = Math.max(before.length, after.length);
  const out = [`--- ${from}`, `+++ ${to}`];
  for (let i = 0; i < max; i += 1) {
    const a = before[i];
    const b = after[i];
    if (a === b) continue;
    if (a !== undefined) out.push(`- ${a}`);
    if (b !== undefined) out.push(`+ ${b}`);
  }
  if (out.length === 2) out.push('  Sem alterações.');
  return out.join('\n');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function createBackup(filePath, backupDir, metadata = {}) {
  ensureDir(backupDir);
  const stamp = timestamp();
  const backupFile = path.join(backupDir, `api.raml.${stamp}.bak`);
  fs.copyFileSync(filePath, backupFile);
  const metaFile = path.join(backupDir, `api.raml.${stamp}.restore-metadata.json`);
  fs.writeFileSync(metaFile, JSON.stringify({ ...metadata, backupFile, createdAt: new Date().toISOString() }, null, 2), 'utf8');
  return { backupFile, metadataFile: metaFile };
}

module.exports = {
  normalizeEol,
  detectEol,
  findPathLine,
  pathExists,
  extractPathBlock,
  replacePath,
  insertEndpointBlock,
  makeUnifiedDiff,
  createBackup
};
