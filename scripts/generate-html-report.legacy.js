#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DIST_DIR = process.env.DIST_DIR || 'dist';
const OUTPUT_HTML = process.env.RELEASE_FLOW_REPORT_HTML || path.join(DIST_DIR, 'release-flow-guardian-report.html');
const OUTPUT_JSON = process.env.RELEASE_FLOW_REPORT_JSON || path.join(DIST_DIR, 'release-flow-guardian-report.json');

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (error) {
    return { error: `Falha ao ler ${file}`, details: String(error.message || error) };
  }
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function statusClass(status) {
  const value = String(status || '').toUpperCase();
  if (value.includes('BLOCK') || value.includes('FAIL') || value.includes('ERROR')) return 'danger';
  if (value.includes('WARN')) return 'warn';
  if (value.includes('PUBLISHED') || value === 'OK' || value === 'READY') return 'ok';
  return 'info';
}

function badge(status, label = status) {
  return `<span class="badge ${statusClass(status)}">${esc(label || status)}</span>`;
}

function card(title, value, status = 'INFO', subtitle = '') {
  return `<section class="card ${statusClass(status)}">
    <div class="card-title">${esc(title)}</div>
    <div class="card-value">${esc(value)}</div>
    ${subtitle ? `<div class="card-subtitle">${esc(subtitle)}</div>` : ''}
  </section>`;
}

function rows(items, mapper) {
  if (!items || !items.length) return '<tr><td colspan="4" class="muted">Nenhum registro.</td></tr>';
  return items.map(mapper).join('\n');
}

function shortSha(value) {
  return value ? String(value).slice(0, 12) : 'local';
}

const contractDiff = readJson(path.join(DIST_DIR, 'api-contract-diff.json'), null);
const currentContract = readJson(path.join(DIST_DIR, 'api-contract-current.json'), null);
const exchangeReport = readJson(path.join(DIST_DIR, 'exchange-publish-report.json'), null);

const context = {
  appName: process.env.APP_NAME || 'mule-tlf-com-test',
  assetId: process.env.EXCHANGE_ASSET_ID || exchangeReport?.assetId || 'mule-tlf-com-test',
  groupId: process.env.EXCHANGE_GROUP_ID || exchangeReport?.groupId || process.env.ANYPOINT_ORG || 'N/A',
  branch: process.env.GITHUB_REF_NAME || process.env.BUILD_SOURCEBRANCHNAME || process.env.BRANCH_NAME || 'local',
  commit: shortSha(process.env.GITHUB_SHA || process.env.BUILD_SOURCEVERSION || ''),
  runId: process.env.GITHUB_RUN_NUMBER || process.env.BUILD_BUILDNUMBER || 'local',
  generatedAt: new Date().toISOString(),
  repository: process.env.GITHUB_REPOSITORY || process.env.BUILD_REPOSITORY_NAME || 'local',
};

const contractStatus = contractDiff?.status || 'NOT_EXECUTED';
const exchangeStatus = exchangeReport?.status || 'NOT_PUBLISHED';
const finalStatus = contractStatus === 'BLOCKED'
  ? 'BLOCKED'
  : exchangeStatus === 'PUBLISHED' || exchangeStatus === 'PUBLISHED_WITH_WARNING'
    ? exchangeStatus
    : contractStatus === 'WARNING'
      ? 'READY_WITH_WARNING'
      : 'READY';

const summary = {
  context,
  finalStatus,
  contract: contractDiff,
  currentContract,
  exchange: exchangeReport
};

fs.mkdirSync(DIST_DIR, { recursive: true });
fs.writeFileSync(OUTPUT_JSON, JSON.stringify(summary, null, 2), 'utf-8');

const endpoints = currentContract?.endpoints || [];
const findings = contractDiff?.findings || [];
const added = contractDiff?.addedEndpoints || [];
const removed = contractDiff?.removedEndpoints || [];
const changed = contractDiff?.changedEndpoints || [];
const exchangeChecks = exchangeReport?.checks || [];
const publishSteps = exchangeReport?.publish || [];

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Release Flow Guardian Report — ${esc(context.appName)}</title>
  <style>
    :root {
      --bg: #050814;
      --panel: rgba(11, 20, 40, 0.88);
      --panel-2: rgba(16, 31, 58, 0.88);
      --line: rgba(0, 221, 255, 0.24);
      --text: #eef7ff;
      --muted: #9db4ca;
      --cyan: #00ddff;
      --blue: #237bff;
      --green: #40f29a;
      --yellow: #ffd166;
      --red: #ff4d6d;
      --purple: #a770ff;
      --shadow: 0 0 32px rgba(0, 221, 255, 0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, Segoe UI, Roboto, Arial, sans-serif;
      background:
        radial-gradient(circle at 12% 8%, rgba(0, 221, 255, 0.16), transparent 28%),
        radial-gradient(circle at 88% 0%, rgba(35, 123, 255, 0.16), transparent 25%),
        linear-gradient(135deg, #03040a 0%, #071325 55%, #03040a 100%);
      color: var(--text);
      min-height: 100vh;
      padding: 32px;
    }
    .shell { max-width: 1280px; margin: 0 auto; }
    .hero {
      border: 1px solid var(--line);
      background: linear-gradient(135deg, rgba(8, 19, 38, 0.94), rgba(8, 14, 30, 0.82));
      border-radius: 28px;
      padding: 32px;
      box-shadow: var(--shadow);
      position: relative;
      overflow: hidden;
    }
    .hero:before {
      content: "";
      position: absolute;
      inset: -1px;
      background: linear-gradient(90deg, transparent, rgba(0,221,255,.18), transparent);
      transform: translateX(-100%);
      animation: scan 7s infinite linear;
      pointer-events: none;
    }
    @keyframes scan { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
    .kicker { color: var(--cyan); font-weight: 800; letter-spacing: .16em; font-size: 12px; text-transform: uppercase; }
    h1 { margin: 10px 0 10px; font-size: clamp(30px, 5vw, 58px); line-height: 1.02; letter-spacing: -0.04em; }
    .subtitle { color: var(--muted); font-size: 17px; max-width: 900px; line-height: 1.55; }
    .meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
    .chip { border: 1px solid var(--line); background: rgba(0, 221, 255, 0.06); border-radius: 999px; padding: 9px 12px; color: #dff8ff; font-size: 13px; }
    .badge { border-radius: 999px; padding: 7px 11px; font-weight: 900; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; border: 1px solid currentColor; }
    .badge.ok { color: var(--green); background: rgba(64,242,154,.1); }
    .badge.warn { color: var(--yellow); background: rgba(255,209,102,.1); }
    .badge.danger { color: var(--red); background: rgba(255,77,109,.1); }
    .badge.info { color: var(--cyan); background: rgba(0,221,255,.1); }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin: 22px 0; }
    .card { border: 1px solid var(--line); background: var(--panel); border-radius: 22px; padding: 18px; box-shadow: var(--shadow); min-height: 122px; }
    .card.ok { border-color: rgba(64,242,154,.32); }
    .card.warn { border-color: rgba(255,209,102,.32); }
    .card.danger { border-color: rgba(255,77,109,.38); }
    .card-title { color: var(--muted); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .card-value { margin-top: 10px; font-size: 28px; font-weight: 900; letter-spacing: -0.04em; }
    .card-subtitle { margin-top: 8px; color: var(--muted); font-size: 13px; line-height: 1.35; }
    .grid { display: grid; grid-template-columns: 1.1fr .9fr; gap: 18px; }
    .section { border: 1px solid var(--line); background: var(--panel); border-radius: 24px; padding: 22px; margin-top: 18px; box-shadow: var(--shadow); }
    .section h2 { margin: 0 0 14px; font-size: 22px; letter-spacing: -0.02em; }
    .section p { color: var(--muted); line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 14px; }
    th { color: var(--cyan); text-align: left; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; padding: 12px; border-bottom: 1px solid var(--line); }
    td { padding: 12px; border-bottom: 1px solid rgba(255,255,255,.06); color: #e8f3ff; vertical-align: top; }
    tr:hover td { background: rgba(0,221,255,.04); }
    .muted { color: var(--muted); }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .pill { display: inline-flex; border-radius: 999px; padding: 5px 9px; font-size: 12px; font-weight: 900; border: 1px solid var(--line); color: var(--cyan); background: rgba(0,221,255,.08); }
    .footer { color: var(--muted); text-align: center; padding: 26px; font-size: 13px; }
    @media (max-width: 980px) { .cards { grid-template-columns: repeat(2, 1fr); } .grid { grid-template-columns: 1fr; } body { padding: 16px; } }
    @media (max-width: 560px) { .cards { grid-template-columns: 1fr; } .hero { padding: 22px; } }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div class="kicker">Release Flow Guardian</div>
      <h1>${esc(context.appName)}</h1>
      <div class="subtitle">Relatório executivo/técnico da validação RAML, Contract Guard, pacote Exchange e publicação com auto bump. O objetivo é detectar perda acidental de endpoint antes da publicação.</div>
      <div class="meta">
        ${badge(finalStatus, finalStatus)}
        <span class="chip">Asset: <strong>${esc(context.assetId)}</strong></span>
        <span class="chip">Branch: <strong>${esc(context.branch)}</strong></span>
        <span class="chip">Commit: <strong>${esc(context.commit)}</strong></span>
        <span class="chip">Run: <strong>${esc(context.runId)}</strong></span>
        <span class="chip">Gerado: <strong>${esc(context.generatedAt)}</strong></span>
      </div>
    </section>

    <section class="cards">
      ${card('Status final', finalStatus, finalStatus, 'Resultado consolidado do Guardian')}
      ${card('Endpoints atuais', endpoints.length, contractStatus, 'Inventário extraído do RAML atual')}
      ${card('Breaking blocks', contractDiff?.summary?.blocks ?? 'N/A', contractDiff?.summary?.blocks ? 'BLOCKED' : 'OK', 'Remoções/quebras sem aprovação')}
      ${card('Exchange version', exchangeReport?.resolvedVersion || 'N/A', exchangeStatus, exchangeReport?.latestVersionFound ? `Última anterior: ${exchangeReport.latestVersionFound}` : 'Ainda não publicado nesta execução')}
    </section>

    <section class="grid">
      <section class="section">
        <h2>API Contract Guard</h2>
        <p>Status: ${badge(contractStatus, contractStatus)} Baseline: <span class="mono">${esc(contractDiff?.baselineSource || 'N/A')}</span></p>
        <table>
          <thead><tr><th>Tipo</th><th>Endpoint</th><th>Detalhe</th><th>Status</th></tr></thead>
          <tbody>
            ${rows(findings, (item) => `<tr><td>${esc(item.ruleId?.split(':')[0] || 'finding')}</td><td class="mono">${esc(item.details?.endpoint || item.details?.endpoint?.id || item.details?.path || '')}</td><td>${esc(item.message)}</td><td>${badge(item.severity, item.severity)}</td></tr>`)}
          </tbody>
        </table>
      </section>

      <section class="section">
        <h2>Resumo do contrato</h2>
        <table>
          <tbody>
            <tr><td>Endpoints anteriores</td><td class="mono">${esc(contractDiff?.summary?.previousEndpoints ?? 'N/A')}</td></tr>
            <tr><td>Endpoints atuais</td><td class="mono">${esc(contractDiff?.summary?.currentEndpoints ?? endpoints.length)}</td></tr>
            <tr><td>Novos</td><td class="mono">${esc(contractDiff?.summary?.addedEndpoints ?? 0)}</td></tr>
            <tr><td>Removidos</td><td class="mono">${esc(contractDiff?.summary?.removedEndpoints ?? 0)}</td></tr>
            <tr><td>Alterados</td><td class="mono">${esc(contractDiff?.summary?.changedEndpoints ?? 0)}</td></tr>
            <tr><td>Warnings aprovados</td><td class="mono">${esc(contractDiff?.summary?.approvedWarnings ?? 0)}</td></tr>
          </tbody>
        </table>
      </section>
    </section>

    <section class="section">
      <h2>Endpoints atuais</h2>
      <table>
        <thead><tr><th>Método</th><th>Path</th><th>Query Params</th><th>Responses</th></tr></thead>
        <tbody>
          ${rows(endpoints, (endpoint) => `<tr><td><span class="pill">${esc(endpoint.method)}</span></td><td class="mono">${esc(endpoint.path)}</td><td>${esc(Object.keys(endpoint.queryParameters || {}).join(', ') || 'nenhum')}</td><td>${esc(Object.keys(endpoint.responses || {}).join(', ') || 'nenhuma')}</td></tr>`)}
        </tbody>
      </table>
    </section>

    <section class="grid">
      <section class="section">
        <h2>Endpoints novos</h2>
        <table><tbody>${rows(added, (endpoint) => `<tr><td><span class="pill">+ ${esc(endpoint.method)}</span></td><td class="mono">${esc(endpoint.path)}</td><td>${esc(endpoint.displayName || '')}</td><td>${badge('OK', 'INFO')}</td></tr>`)}</tbody></table>
      </section>
      <section class="section">
        <h2>Endpoints removidos</h2>
        <table><tbody>${rows(removed, (endpoint) => `<tr><td><span class="pill">- ${esc(endpoint.method)}</span></td><td class="mono">${esc(endpoint.path)}</td><td>${esc(endpoint.displayName || '')}</td><td>${badge('BLOCKED', 'BLOCK')}</td></tr>`)}</tbody></table>
      </section>
    </section>

    <section class="section">
      <h2>Exchange Publish</h2>
      <p>Status: ${badge(exchangeStatus, exchangeStatus)} Asset: <span class="mono">${esc(context.groupId)}/${esc(context.assetId)}</span></p>
      <table>
        <thead><tr><th>Etapa</th><th>Mensagem</th><th>Detalhe</th><th>Status</th></tr></thead>
        <tbody>
          ${rows([...exchangeChecks, ...publishSteps], (item, index) => `<tr><td>${index + 1}</td><td>${esc(item.message)}</td><td class="mono">${esc(item.details || '')}</td><td>${badge(item.status, item.status)}</td></tr>`)}
        </tbody>
      </table>
    </section>

    <section class="section">
      <h2>Arquivos de evidência</h2>
      <table>
        <tbody>
          <tr><td>HTML</td><td class="mono">${esc(OUTPUT_HTML)}</td></tr>
          <tr><td>JSON consolidado</td><td class="mono">${esc(OUTPUT_JSON)}</td></tr>
          <tr><td>Contract diff</td><td class="mono">${esc(path.join(DIST_DIR, 'api-contract-diff.json'))}</td></tr>
          <tr><td>Exchange report</td><td class="mono">${esc(path.join(DIST_DIR, 'exchange-publish-report.json'))}</td></tr>
        </tbody>
      </table>
    </section>

    <div class="footer">Release Flow Guardian • Código fonte na main • Evidência como artifact • Histórico consultável fora da branch principal</div>
  </main>
</body>
</html>`;

fs.writeFileSync(OUTPUT_HTML, html, 'utf-8');

console.log('================================================================================');
console.log('HTML REPORT');
console.log('================================================================================');
console.log(`✅ HTML gerado: ${OUTPUT_HTML}`);
console.log(`✅ JSON consolidado: ${OUTPUT_JSON}`);
