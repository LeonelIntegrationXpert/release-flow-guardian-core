#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadConfig, resolveStability } = require('./guardian-config');

const DIST_DIR = process.env.DIST_DIR || 'dist';
fs.mkdirSync(DIST_DIR, { recursive: true });

const config = loadConfig();
const result = resolveStability(config);
const output = path.join(DIST_DIR, 'version-stability.json');
fs.writeFileSync(output, JSON.stringify(result, null, 2), 'utf8');

console.log('================================================================================');
console.log('RELEASE FLOW GUARDIAN — VERSION STABILITY');
console.log('================================================================================');
console.log(`Branch: ${result.branch}`);
console.log(`Matched rule: ${result.matchedRule}`);
console.log(`Stability: ${result.stability.toUpperCase()}`);
console.log(`Baseline update allowed: ${result.baselineUpdateAllowed ? 'YES' : 'NO'}`);
console.log(`Arquivo: ${output}`);
