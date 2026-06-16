#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadConfig, resolveStability } = require('./guardian-config');
const { readHistory, getHistorySummary, appendHistoryEvent } = require('./guardian-history');

const DIST_DIR = process.env.DIST_DIR || 'dist';
const OUTPUT_HTML = path.join(DIST_DIR, 'release-flow-guardian-report.html');
const OUTPUT_JSON = path.join(DIST_DIR, 'release-flow-guardian-report.json');
const OUTPUT_MD = path.join(DIST_DIR, 'release-flow-guardian-report.md');

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function esc(v) { return String(v ?? '').replace(/[&<>\"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
function statusClass(v) {
  const s = String(v || '').toUpperCase();
  if (s.includes('BLOCK') || s.includes('ERROR') || s.includes('FAIL')) return 'danger';
  if (s.includes('WARN') || s.includes('RC') || s.includes('BETA')) return 'warn';
  if (s.includes('OK') || s.includes('READY') || s.includes('PUBLISH') || s.includes('STABLE')) return 'ok';
  return 'info';
}
function badge(v, label = v) { return `<span class="badge ${statusClass(v)}">${esc(label || v)}</span>`; }
function card(title, value, status='INFO', subtitle='') {
  return `<section class="card ${statusClass(status)}"><div class="card-title">${esc(title)}</div><div class="card-value">${esc(value)}</div>${subtitle ? `<div class="card-subtitle">${esc(subtitle)}</div>` : ''}</section>`;
}
function rows(items, mapper, colspan = 6) {
  if (!items || !items.length) return `<tr><td colspan="${colspan}" class="muted">Nenhum registro.</td></tr>`;
  return items.map(mapper).join('\n');
}
function short(v) { return v ? String(v).slice(0, 12) : 'local'; }
function endpointKey(e) { return `${String(e.method || '').toUpperCase()} ${e.path || ''}`.trim(); }

fs.mkdirSync(DIST_DIR, { recursive: true });

const config = loadConfig();
const stability = resolveStability(config);
const currentContract = readJson(path.join(DIST_DIR, 'api-contract-current.json'), { endpoints: [] });
const baselineContract = readJson(path.join(DIST_DIR, 'api-contract-baseline-used.json'), readJson(config.contractGuard?.baselineFile || 'release/api-contract-baseline.json', { endpoints: [] }));
const contractDiff = readJson(path.join(DIST_DIR, 'api-contract-diff.json'), { status: 'NOT_EXECUTED', findings: [], addedEndpoints: [], removedEndpoints: [], changedEndpoints: [], summary: {} });
const exchangeReport = readJson(path.join(DIST_DIR, 'exchange-publish-report.json'), null);
const historyEvents = readHistory(100).reverse();
const historySummary = getHistorySummary();

const context = {
  projectName: config.project?.name || process.env.APP_NAME || 'mule-tlf-com-test',
  displayName: config.project?.displayName || 'Mule TLF COM Test',
  assetId: config.exchange?.assetId || process.env.EXCHANGE_ASSET_ID || 'mule-tlf-com-test',
  branch: stability.branch,
  commit: short(process.env.GITHUB_SHA || process.env.BUILD_SOURCEVERSION || ''),
  provider: process.env.GITHUB_ACTIONS ? 'github' : process.env.TF_BUILD ? 'azure' : 'local',
  runId: process.env.GITHUB_RUN_NUMBER || process.env.BUILD_BUILDNUMBER || 'local',
  generatedAt: new Date().toISOString()
};

const finalStatus = contractDiff.status === 'BLOCKED'
  ? 'BLOCKED'
  : exchangeReport?.status === 'PUBLISHED' || exchangeReport?.status === 'PUBLISHED_WITH_WARNING'
    ? exchangeReport.status
    : contractDiff.status === 'WARNING'
      ? 'WARNING'
      : 'READY';

const approvals = contractDiff.approval || {};
const removedApproved = new Set((approvals.removedEndpoints || []).map(endpointKey));
const currentEndpoints = currentContract.endpoints || [];
const baselineEndpoints = baselineContract.endpoints || [];
const currentMap = new Map(currentEndpoints.map(e => [e.id || endpointKey(e), e]));
const baselineMap = new Map(baselineEndpoints.map(e => [e.id || endpointKey(e), e]));
const inventory = [];
for (const id of new Set([...currentMap.keys(), ...baselineMap.keys()])) {
  const cur = currentMap.get(id);
  const base = baselineMap.get(id);
  const endpoint = cur || base;
  const status = cur && base ? 'EXISTING' : cur ? 'NEW' : 'REMOVED';
  const decision = status === 'REMOVED' ? (removedApproved.has(endpointKey(endpoint)) ? 'APPROVED_REMOVAL' : 'BLOCK') : 'OK';
  inventory.push({ id, endpoint, status, decision });
}
inventory.sort((a,b)=>a.id.localeCompare(b.id));

const possibleReplacements = contractDiff.possibleReplacements || contractDiff.stableBaselineGuard?.possibleReplacements || [];
const approvedBreakingChanges = contractDiff.approvedBreakingChanges || contractDiff.stableBaselineGuard?.approvedBreakingChanges || [];
const blockedBreakingChanges = contractDiff.blockedBreakingChanges || contractDiff.stableBaselineGuard?.blockedBreakingChanges || [];
const restoreEvents = historyEvents.filter(e => String(e.eventType || '').includes('RESTORE') || String(e.eventType || '').includes('RESTORED'));
const restoreCandidates = [
  ...possibleReplacements.map(p => ({ type: 'PATH_RESTORE', method: p.oldMethod || p.method || '', baselinePath: p.oldPath || p.path || '', currentPath: p.newPath || p.replacement || '', action: 'RESTORE_AVAILABLE', result: 'NOT_EXECUTED', similarityScore: p.similarityScore || 0 })),
  ...inventory.filter(i => i.status === 'REMOVED').map(i => ({ type: 'ENDPOINT_BLOCK_RESTORE', method: i.endpoint.method || '', baselinePath: i.endpoint.path || '', currentPath: '', action: 'RESTORE_AVAILABLE', result: 'NOT_EXECUTED', similarityScore: '' }))
];

const summary = {
  context,
  finalStatus,
  stability,
  configSnapshot: config,
  contract: contractDiff,
  currentContract,
  baselineContract,
  endpointGovernance: {
    totalBaseline: baselineEndpoints.length,
    totalCurrent: currentEndpoints.length,
    totalNew: inventory.filter(i => i.status === 'NEW').length,
    totalRemoved: inventory.filter(i => i.status === 'REMOVED').length,
    totalBlocked: inventory.filter(i => i.decision === 'BLOCK').length,
    totalApproved: inventory.filter(i => i.decision === 'APPROVED_REMOVAL').length,
    totalPossibleReplacements: possibleReplacements.length,
    approvedBreakingChanges: approvedBreakingChanges.length,
    blockedBreakingChanges: blockedBreakingChanges.length,
    inventory,
    possibleReplacements
  },
  exchange: exchangeReport,
  history: { summary: historySummary, events: historyEvents.slice(-50) },
  restore: { candidates: restoreCandidates, events: restoreEvents.slice(-50), executed: restoreEvents.filter(e => String(e.eventType || '').includes('RESTORED')).length, failures: restoreEvents.filter(e => String(e.eventType || '').includes('FAILED')).length }
};

fs.writeFileSync(OUTPUT_JSON, JSON.stringify(summary, null, 2), 'utf8');
fs.writeFileSync(path.join(DIST_DIR, 'guardian.config.snapshot.yml'), fs.existsSync('release/guardian.config.yml') ? fs.readFileSync('release/guardian.config.yml') : '', 'utf8');

const findings = contractDiff.findings || [];
const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Release Flow Guardian — ${esc(context.projectName)}</title><style>
:root{--bg:#050814;--panel:rgba(10,18,36,.9);--panel2:rgba(15,31,58,.9);--line:rgba(0,221,255,.25);--text:#eef7ff;--muted:#9db4ca;--cyan:#00ddff;--blue:#2979ff;--green:#40f29a;--yellow:#ffd166;--red:#ff4d6d;--shadow:0 0 34px rgba(0,221,255,.12)}*{box-sizing:border-box}body{margin:0;padding:30px;background:radial-gradient(circle at 10% 0,rgba(0,221,255,.17),transparent 28%),linear-gradient(135deg,#03040a,#071325 55%,#03040a);font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;color:var(--text)}.shell{max-width:1320px;margin:auto}.hero,.section,.card{border:1px solid var(--line);background:var(--panel);border-radius:26px;box-shadow:var(--shadow)}.hero{padding:30px;margin-bottom:18px;overflow:hidden;position:relative}.kicker{color:var(--cyan);font-weight:900;font-size:12px;letter-spacing:.15em;text-transform:uppercase}h1{font-size:clamp(32px,5vw,58px);letter-spacing:-.045em;margin:8px 0}.subtitle{color:var(--muted);max-width:900px;line-height:1.55}.chips{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}.chip{border:1px solid var(--line);border-radius:999px;padding:8px 12px;background:rgba(0,221,255,.07)}.badge{border:1px solid currentColor;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:1000;text-transform:uppercase}.ok{color:var(--green)}.warn{color:var(--yellow)}.danger{color:var(--red)}.info{color:var(--cyan)}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.card{padding:18px;min-height:118px}.card-title{color:var(--muted);font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:900}.card-value{font-size:30px;font-weight:1000;margin-top:10px;letter-spacing:-.04em}.card-subtitle{color:var(--muted);font-size:13px;margin-top:8px}.section{padding:22px;margin-top:18px}.section h2{margin:0 0 14px}table{width:100%;border-collapse:collapse;overflow:hidden;border-radius:14px}th{text-align:left;color:var(--cyan);font-size:12px;text-transform:uppercase;letter-spacing:.08em;padding:12px;border-bottom:1px solid var(--line)}td{padding:12px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:top}.muted{color:var(--muted)}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.footer{text-align:center;color:var(--muted);padding:25px}@media(max-width:900px){body{padding:15px}.cards{grid-template-columns:1fr 1fr}}@media(max-width:560px){.cards{grid-template-columns:1fr}}
</style></head><body><main class="shell">
<section class="hero"><div class="kicker">Release Flow Guardian Report</div><h1>${esc(context.displayName)}</h1><p class="subtitle">Relatório executivo/técnico com validação RAML, manifesto, Contract Guard, Endpoint Governance, stability e Exchange Publish. Regra segura: endpoint removido sem aprovação explícita bloqueia a publicação.</p><div class="chips">${badge(finalStatus, finalStatus)}<span class="chip">Asset: <strong>${esc(context.assetId)}</strong></span><span class="chip">Branch: <strong>${esc(context.branch)}</strong></span><span class="chip">Commit: <strong>${esc(context.commit)}</strong></span><span class="chip">Provider: <strong>${esc(context.provider)}</strong></span><span class="chip">Stability: <strong>${esc(stability.stability.toUpperCase())}</strong></span></div></section>
<section class="cards">
${card('Status final', finalStatus, finalStatus, 'Resultado consolidado')}
${card('Stability', stability.stability.toUpperCase(), stability.stability, `Regra: ${stability.matchedRule}`)}
${card('Endpoints atuais', currentEndpoints.length, contractDiff.status, `Baseline: ${baselineEndpoints.length}`)}
${card('Blocks', contractDiff.summary?.blocks ?? 0, contractDiff.summary?.blocks ? 'BLOCKED' : 'OK', 'Quebras sem aprovação')}
${card('Novos', summary.endpointGovernance.totalNew, 'INFO', 'Permitido por padrão')}
${card('Removidos', summary.endpointGovernance.totalRemoved, summary.endpointGovernance.totalRemoved ? 'WARNING' : 'OK', 'Default: BLOCK')}
${card('Possible replacements', possibleReplacements.length, possibleReplacements.length ? 'WARNING' : 'OK', 'REMOVED + NEW parecido')}
${card('Aprovados', summary.endpointGovernance.totalApproved + approvedBreakingChanges.length, (summary.endpointGovernance.totalApproved + approvedBreakingChanges.length) ? 'WARNING' : 'OK', 'WARN + permite')}
${card('Exchange Version', exchangeReport?.resolvedVersion || 'N/A', exchangeReport?.status || 'INFO', exchangeReport?.latestVersionFound ? `Última: ${exchangeReport.latestVersionFound}` : 'Sem publish nesta execução')}
${card('Histórico', historySummary.total || 0, 'INFO', 'eventos auditáveis')}
${card('Restore candidates', restoreCandidates.length, restoreCandidates.length ? 'WARNING' : 'OK', 'path/block restore')}
${card('Restores executed', restoreEvents.filter(e => String(e.eventType || '').includes('RESTORED')).length, 'INFO', 'ações registradas')}
</section>
<section class="section"><h2>Endpoint Governance</h2><table><thead><tr><th>Status</th><th>Method</th><th>Path</th><th>Decision</th><th>Query Params</th><th>Responses</th></tr></thead><tbody>${rows(inventory, i => `<tr><td>${badge(i.status,i.status)}</td><td>${esc(i.endpoint.method)}</td><td class="mono">${esc(i.endpoint.path)}</td><td>${badge(i.decision,i.decision)}</td><td>${esc(Object.keys(i.endpoint.queryParameters||{}).join(', ') || '-')}</td><td>${esc(Object.keys(i.endpoint.responses||{}).join(', ') || '-')}</td></tr>`)}</tbody></table></section>
<section class="section"><h2>Breaking Change Intelligence</h2><table><thead><tr><th>Type</th><th>Old endpoint</th><th>New endpoint</th><th>Similarity</th><th>Decision</th><th>Approval</th></tr></thead><tbody>${rows(possibleReplacements, p => `<tr><td>${badge(p.type || 'POSSIBLE_REPLACEMENT')}</td><td><strong>${esc(p.oldMethod)}</strong><br><span class="mono">${esc(p.oldPath)}</span></td><td><strong>${esc(p.newMethod)}</strong><br><span class="mono">${esc(p.newPath)}</span></td><td>${esc(p.similarityScore || 0)}%</td><td>${badge(p.decision || 'BLOCK')}</td><td>${badge(p.approvalStatus || 'NOT_APPROVED')}</td></tr>`, 6)}</tbody></table></section>
<section class="section"><h2>Contract Guard Findings</h2><table><thead><tr><th>Severity</th><th>Rule</th><th>Message</th><th>Approval</th></tr></thead><tbody>${rows(findings, f => `<tr><td>${badge(f.severity,f.severity)}</td><td class="mono">${esc(f.ruleId)}</td><td>${esc(f.message)}</td><td>${f.details?.approval ? `${esc(f.details.approval.ticket)}<br>${esc(f.details.approval.reason)}` : '-'}</td></tr>`, 4)}</tbody></table></section>

<section class="section"><h2>Restore Intelligence</h2><table><thead><tr><th>Type</th><th>Method</th><th>Baseline Path</th><th>Current Path</th><th>Action</th><th>Backup</th><th>Result</th><th>Created At</th></tr></thead><tbody>${rows(restoreCandidates, r => `<tr><td>${badge(r.type)}</td><td>${esc(r.method)}</td><td class="mono">${esc(r.baselinePath || '-')}</td><td class="mono">${esc(r.currentPath || '-')}</td><td>${badge(r.action || 'RESTORE_AVAILABLE')}</td><td>-</td><td>${badge(r.result || 'NOT_EXECUTED')}</td><td>-</td></tr>`, 8)}${restoreEvents.length ? rows(restoreEvents.slice(-20).reverse(), e => `<tr><td>${badge(e.eventType || 'RESTORE')}</td><td>${esc(e.method || e.oldMethod || '')}</td><td class="mono">${esc(e.baselinePath || e.oldPath || '')}</td><td class="mono">${esc(e.currentPathBeforeRestore || e.newPath || '')}</td><td>${badge(e.action || 'restored')}</td><td class="mono">${esc(e.backupFile || e.file || '-')}</td><td>${badge(e.decision || e.severity || 'INFO')}</td><td>${esc(e.createdAt || '')}</td></tr>`, 8) : ''}</tbody></table></section>
<section class="section"><h2>Change History</h2><table><thead><tr><th>Data</th><th>Evento</th><th>Mudança</th><th>Decisão</th><th>Ticket</th><th>Ator</th><th>Git</th></tr></thead><tbody>${rows(historyEvents.slice(-30).reverse(), e => { const oldEp = e.oldPath ? `${e.oldMethod || ''} ${e.oldPath}`.trim() : ''; const newEp = e.newPath ? `${e.newMethod || ''} ${e.newPath}`.trim() : ''; const ep = e.path ? `${e.method || ''} ${e.path}`.trim() : ''; const change = oldEp || newEp ? `${esc(oldEp || '-')}<br>→ ${esc(newEp || '-')}` : esc(ep || e.message || e.changeType || '-'); return `<tr><td>${esc(e.createdAt || '')}</td><td>${badge(e.eventType || 'EVENT')}</td><td class="mono">${change}</td><td>${badge(e.decision || e.severity || 'INFO')}</td><td>${esc(e.ticket || '-')}<br>${esc(e.reason || '')}</td><td>${esc(e.actor?.name || '-')}<br>${esc(e.actor?.email || e.actor?.gitUserEmail || '')}</td><td>${esc(e.git?.branch || '-')}<br><span class="mono">${esc(e.git?.commitShort || '')}</span></td></tr>`; }, 7)}</tbody></table></section>
<section class="section"><h2>Exchange</h2><table><tbody><tr><td>Asset ID</td><td class="mono">${esc(context.assetId)}</td></tr><tr><td>Minor line</td><td>${esc(config.versioning?.minorLine || '1.0')}</td></tr><tr><td>Initial version</td><td>${esc(config.versioning?.initialVersion || '1.0.0')}</td></tr><tr><td>Resolved version</td><td>${esc(exchangeReport?.resolvedVersion || 'N/A')}</td></tr><tr><td>Publish result</td><td>${badge(exchangeReport?.status || 'NOT_PUBLISHED')}</td></tr></tbody></table></section>
<section class="section"><h2>Stability / Baseline</h2><table><tbody><tr><td>Branch</td><td>${esc(stability.branch)}</td></tr><tr><td>Matched rule</td><td>${esc(stability.matchedRule)}</td></tr><tr><td>Stability</td><td>${badge(stability.stability, stability.stability)}</td></tr><tr><td>Baseline update allowed</td><td>${stability.baselineUpdateAllowed ? badge('OK','YES') : badge('WARN','NO')}</td></tr></tbody></table></section>
<div class="footer">Gerado em ${esc(context.generatedAt)} • Release Flow Guardian</div>
</main></body></html>`;

fs.writeFileSync(OUTPUT_HTML, html, 'utf8');

const md = [
  '# Release Flow Guardian Report', '',
  `- **Project:** ${context.projectName}`,
  `- **Asset:** ${context.assetId}`,
  `- **Branch:** ${context.branch}`,
  `- **Commit:** ${context.commit}`,
  `- **Status:** ${finalStatus}`,
  `- **Stability:** ${stability.stability}`,
  '',
  '## Endpoint Governance', '',
  `- Baseline endpoints: ${baselineEndpoints.length}`,
  `- Current endpoints: ${currentEndpoints.length}`,
  `- New endpoints: ${summary.endpointGovernance.totalNew}`,
  `- Removed endpoints: ${summary.endpointGovernance.totalRemoved}`,
  `- Possible replacements: ${possibleReplacements.length}`,
  `- Blocked removals: ${summary.endpointGovernance.totalBlocked}`, 
  `- Approved removals: ${summary.endpointGovernance.totalApproved}`,
  '',
  '## Breaking Change Intelligence',
  '',
  ...(possibleReplacements.length ? possibleReplacements.map(p => `- [${p.decision || 'BLOCK'}] ${p.oldMethod} ${p.oldPath} -> ${p.newMethod} ${p.newPath} (${p.similarityScore || 0}%)`) : ['- Nenhum possible replacement.']),
  '',
  '## Restore Intelligence', '',
  ...(restoreCandidates.length ? restoreCandidates.map(r => `- [${r.action}] ${r.type} ${r.method} ${r.baselinePath} -> ${r.currentPath || '(restore block)'}`) : ['- Nenhum candidato de restore.']),
  ...(restoreEvents.length ? restoreEvents.slice(-10).reverse().map(e => `- [${e.eventType}] ${e.baselinePath || e.oldPath || ''} -> ${e.currentPathAfterRestore || e.currentPathBeforeRestore || e.newPath || ''} — ${e.decision || e.severity || 'INFO'}`) : []),
  '',
  '## Change History', '',
  ...(historyEvents.slice(-20).reverse().length ? historyEvents.slice(-20).reverse().map(e => `- [${e.eventType}] ${e.oldPath ? `${e.oldMethod || ''} ${e.oldPath} -> ${e.newMethod || ''} ${e.newPath || ''}` : (e.path ? `${e.method || ''} ${e.path}` : e.message || e.changeType || '')} — ${e.decision || e.severity || 'INFO'} — ${e.actor?.email || e.actor?.name || 'unknown'}`) : ['- Nenhum evento histórico.']),
  '',
  '## Findings', '',
  ...(findings.length ? findings.map(f => `- [${f.severity}] ${f.message} (${f.ruleId})`) : ['- Nenhum finding.']),
  ''
].join('\n');
fs.writeFileSync(OUTPUT_MD, md, 'utf8');
try { appendHistoryEvent({ source: 'report-html', eventType: 'REPORT_GENERATED', action: 'generated', changeType: 'report', severity: 'INFO', decision: finalStatus, file: OUTPUT_HTML, summary: summary.endpointGovernance }, { dedupe: false }); } catch (historyError) { console.warn(`⚠️ Não foi possível registrar histórico do report: ${historyError.message}`); }

console.log('================================================================================');
console.log('HTML REPORT');
console.log('================================================================================');
console.log(`✅ HTML gerado: ${OUTPUT_HTML}`);
console.log(`✅ JSON consolidado: ${OUTPUT_JSON}`);
console.log(`✅ Markdown gerado: ${OUTPUT_MD}`);
