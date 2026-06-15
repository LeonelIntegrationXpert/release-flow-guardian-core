#!/usr/bin/env node
const { readHistory, getHistorySummary, getHistoryConfig } = require('./guardian-history');

const summaryMode = process.argv.includes('--summary');
const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 50;

if (summaryMode) {
  const summary = getHistorySummary();
  console.log('================================================================================');
  console.log('RELEASE FLOW GUARDIAN — HISTORY SUMMARY');
  console.log('================================================================================');
  console.log(`Arquivo: ${summary.file}`);
  console.log(`Total: ${summary.total}`);
  console.log('\nPor tipo:');
  for (const [key, value] of Object.entries(summary.byType)) console.log(`- ${key}: ${value}`);
  console.log('\nPor decisão:');
  for (const [key, value] of Object.entries(summary.byDecision)) console.log(`- ${key}: ${value}`);
  console.log('\nAtores:');
  for (const [key, value] of Object.entries(summary.byActor)) console.log(`- ${key}: ${value}`);
  process.exit(0);
}

const cfg = getHistoryConfig();
const events = readHistory(limit);
console.log('================================================================================');
console.log('RELEASE FLOW GUARDIAN — CHANGE HISTORY');
console.log('================================================================================');
console.log(`Arquivo: ${cfg.file}`);
console.log(`Eventos exibidos: ${events.length}`);
console.log('');
for (const event of events) {
  const oldEndpoint = event.oldPath ? `${event.oldMethod || ''} ${event.oldPath}`.trim() : '';
  const newEndpoint = event.newPath ? `${event.newMethod || ''} ${event.newPath}`.trim() : '';
  const endpoint = event.path ? `${event.method || ''} ${event.path}`.trim() : '';
  console.log(`[${event.createdAt}] ${event.eventType} ${event.decision || event.severity || ''}`);
  if (endpoint) console.log(`  Endpoint: ${endpoint}`);
  if (oldEndpoint || newEndpoint) console.log(`  Change:   ${oldEndpoint} -> ${newEndpoint}`);
  if (event.ticket) console.log(`  Ticket:   ${event.ticket}`);
  console.log(`  Actor:    ${event.actor?.name || '-'} ${event.actor?.email || ''}`.trim());
  console.log(`  Git:      ${event.git?.branch || '-'} ${event.git?.commitShort || ''}`.trim());
  if (event.reason) console.log(`  Reason:   ${event.reason}`);
  console.log('');
}
