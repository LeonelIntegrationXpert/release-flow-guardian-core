let state = { config: null, breaking: null, current: null, baseline: null, diff: null, selectedRemoval: null, filter: 'all' };

const FILE_MODE = window.location.protocol === 'file:';
const API_ROOT = FILE_MODE ? 'http://127.0.0.1:3030' : '';

function showFileModeNotice() {
  if (!FILE_MODE) return;
  const box = document.createElement('div');
  box.className = 'file-mode-warning';
  box.innerHTML = `
    <strong>Console aberto via arquivo local.</strong>
    <span>Para funcionar 100%, rode <code>tools\guardian.cmd</code> e escolha Abrir console local. Acesse <a href="http://127.0.0.1:3030">http://127.0.0.1:3030</a>.</span>
    <span>Mesmo assim, vou tentar usar a API local em <code>http://127.0.0.1:3030</code>.</span>
  `;
  document.body.prepend(box);
}

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

function msg(text, error = false) {
  const el = document.createElement('div');
  el.className = `msg ${error ? 'error' : ''}`;
  el.textContent = text;
  $('messages').prepend(el);
  setTimeout(() => el.remove(), 8000);
}

async function api(path, options = {}) {
  const url = `${API_ROOT}${path}`;
  let res;
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      mode: 'cors',
      ...options
    });
  } catch (error) {
    if (FILE_MODE) {
      throw new Error('Console aberto pelo index.html direto. Rode tools\\guardian.cmd e escolha Abrir console local. Abra http://127.0.0.1:3030. Detalhe: ' + error.message);
    }
    throw error;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || (data.errors || []).join(', ') || `HTTP ${res.status}`);
  return data;
}

function pathGet(obj, path) { return path.split('.').reduce((o,k)=>o?.[k], obj); }
function pathSet(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  while (parts.length > 1) { const p = parts.shift(); cur[p] = cur[p] || {}; cur = cur[p]; }
  cur[parts[0]] = value;
}

function field(label, path, type = 'text') {
  const value = pathGet(state.config, path);
  if (type === 'checkbox') return `<label>${label}<input type="checkbox" data-path="${path}" ${value ? 'checked' : ''}></label>`;
  return `<label>${label}<input data-path="${path}" value="${esc(value)}"></label>`;
}

function bindInputs() {
  document.querySelectorAll('[data-path]').forEach(input => {
    input.addEventListener('change', () => {
      const type = input.type;
      let value = type === 'checkbox' ? input.checked : input.value;
      if (input.dataset.number === 'true') value = Number(value);
      pathSet(state.config, input.dataset.path, value);
      renderDashboard();
    });
  });
}

function renderForms() {
  $('projectForm').innerHTML = [
    field('Nome técnico', 'project.name'), field('Nome visual', 'project.displayName'),
    field('Tipo', 'project.type'), field('RAML principal', 'project.mainFile'),
    field('Owner', 'project.owner'), field('Descrição', 'project.description')
  ].join('');

  $('exchangeForm').innerHTML = [
    field('Exchange habilitado', 'exchange.enabled', 'checkbox'), field('Asset ID', 'exchange.assetId'),
    field('Asset Name', 'exchange.assetName'), field('Descrição', 'exchange.assetDescription'),
    field('Classifier', 'exchange.classifier'), field('Main File', 'exchange.mainFile'),
    field('Auto bump habilitado', 'exchange.autoBump.enabled', 'checkbox'),
    `<label>Max 409 retries<input data-path="exchange.autoBump.max409Retries" data-number="true" value="${esc(pathGet(state.config,'exchange.autoBump.max409Retries'))}"></label>`,
    `<label>Retry 429<input data-path="exchange.autoBump.retry429MaxAttempts" data-number="true" value="${esc(pathGet(state.config,'exchange.autoBump.retry429MaxAttempts'))}"></label>`,
    `<label>Retry 5xx<input data-path="exchange.autoBump.retry5xxMaxAttempts" data-number="true" value="${esc(pathGet(state.config,'exchange.autoBump.retry5xxMaxAttempts'))}"></label>`,
    `<label>Backoff seconds<input data-path="exchange.autoBump.backoffSeconds" data-number="true" value="${esc(pathGet(state.config,'exchange.autoBump.backoffSeconds'))}"></label>`
  ].join('');

  $('versioningForm').innerHTML = [
    field('Minor line', 'versioning.minorLine'), field('Initial version', 'versioning.initialVersion'),
    field('Strategy', 'versioning.strategy'), field('Stability default', 'versioning.stability.default'),
    field('feature/*', 'versioning.branchRules.feature/*'), field('develop', 'versioning.branchRules.develop'),
    field('release/next', 'versioning.branchRules.release/next'), field('release/current', 'versioning.branchRules.release/current'),
    field('main', 'versioning.branchRules.main'), field('master', 'versioning.branchRules.master')
  ].join('');

  $('contractForm').innerHTML = [
    field('Contract Guard habilitado', 'contractGuard.enabled', 'checkbox'), field('Baseline mode', 'contractGuard.baselineMode'),
    field('Bloquear endpoint removido', 'contractGuard.blockRemovedEndpoints', 'checkbox'),
    field('Bloquear método removido', 'contractGuard.blockRemovedMethods', 'checkbox'),
    field('Bloquear query param obrigatório removido', 'contractGuard.blockRemovedRequiredQueryParams', 'checkbox'),
    field('Bloquear URI param removido', 'contractGuard.blockRemovedUriParams', 'checkbox'),
    field('Bloquear response sucesso removida', 'contractGuard.blockRemovedSuccessResponses', 'checkbox'),
    field('Bloquear security removida', 'contractGuard.blockRemovedSecurity', 'checkbox'),
    field('Bloquear trait removida', 'contractGuard.blockRemovedTraits', 'checkbox'),
    field('Permitir breaking change aprovada', 'contractGuard.allowApprovedBreakingChanges', 'checkbox')
  ].join('');

  const secrets = pathGet(state.config, 'security.requiredSecrets') || [];
  $('secretList').innerHTML = secrets.map(s => `<div class="secret">${esc(s)}</div>`).join('');
  bindInputs();
}

function badge(value) {
  const v = String(value || 'INFO').toUpperCase();
  const cls = v.includes('BLOCK') ? 'block' : v.includes('WARN') || v.includes('REMOVED') ? 'warn' : v.includes('OK') || v.includes('EXISTING') ? 'ok' : 'info';
  return `<span class="badge ${cls}">${esc(v)}</span>`;
}

function renderDashboard() {
  const endpoints = state.current?.endpoints || [];
  const base = state.baseline?.endpoints || [];
  const diff = state.diff || {};
  const stability = pathGet(state.config || {}, 'versioning.stability.default') || 'draft';
  $('dashboardCards').innerHTML = [
    card('Projeto', pathGet(state.config,'project.name') || 'N/A', pathGet(state.config,'project.mainFile') || ''),
    card('Asset ID', pathGet(state.config,'exchange.assetId') || 'N/A', 'Exchange'),
    card('Stability default', String(stability).toUpperCase(), 'branch rules'),
    card('Endpoints atuais', endpoints.length, `baseline: ${base.length}`),
    card('Novos', diff.summary?.addedEndpoints ?? 0, 'permitido'),
    card('Removidos', diff.summary?.removedEndpoints ?? 0, 'default: BLOCK'),
    card('Blocks', diff.summary?.blocks ?? 0, 'sem aprovação'),
    card('Contract Guard', diff.status || 'N/A', 'status')
  ].join('');
}
function card(title, value, sub='') { return `<div class="card"><div class="card-title">${esc(title)}</div><div class="card-value">${esc(value)}</div><div class="muted">${esc(sub)}</div></div>`; }

function endpointRows() {
  const rows = [];
  const current = new Map((state.current?.endpoints || []).map(e => [e.id, e]));
  const baseline = new Map((state.baseline?.endpoints || []).map(e => [e.id, e]));
  const removedApproved = new Set((state.breaking?.breakingChanges?.removedEndpoints || []).map(e => `${String(e.method).toUpperCase()} ${e.path}`));
  const ids = new Set([...current.keys(), ...baseline.keys()]);
  for (const id of ids) {
    const cur = current.get(id); const base = baseline.get(id);
    let status = cur && base ? 'EXISTING' : cur ? 'NEW' : 'REMOVED';
    let decision = status === 'REMOVED' ? (removedApproved.has(id) ? 'APPROVED_REMOVAL' : 'BLOCK') : 'OK';
    const e = cur || base;
    rows.push({ status, method:e.method, path:e.path, id, decision, endpoint:e });
  }
  return rows.sort((a,b)=>a.id.localeCompare(b.id));
}

function shouldShow(row) {
  const f = state.filter;
  if (f === 'all') return true;
  if (f === 'new') return row.status === 'NEW';
  if (f === 'removed') return row.status === 'REMOVED';
  if (f === 'blocked') return row.decision === 'BLOCK';
  if (f === 'approved') return row.decision === 'APPROVED_REMOVAL';
  if (f === 'changed') return false;
  return true;
}

function renderEndpoints() {
  const rows = endpointRows().filter(shouldShow);
  $('endpointTable').innerHTML = `<thead><tr><th>Status</th><th>Method</th><th>Path</th><th>Params</th><th>Responses</th><th>Decision</th><th>Ação</th></tr></thead><tbody>` + rows.map(r => {
    const e = r.endpoint;
    const q = Object.keys(e.queryParameters || {}).join(', ') || '-';
    const u = Object.keys(e.uriParameters || {}).join(', ') || '-';
    const res = Object.keys(e.responses || {}).join(', ') || '-';
    const action = r.status === 'REMOVED' ? `<button class="btn" data-approve="${esc(r.id)}">Aprovar</button>` : '-';
    return `<tr><td>${badge(r.status)}</td><td>${esc(r.method)}</td><td><code>${esc(r.path)}</code></td><td>URI: ${esc(u)}<br>Query: ${esc(q)}</td><td>${esc(res)}</td><td>${badge(r.decision)}</td><td>${action}</td></tr>`;
  }).join('') + '</tbody>';

  $('approvalTable').innerHTML = `<thead><tr><th>Method</th><th>Path</th><th>Decision</th><th>Ticket</th><th>Ação</th></tr></thead><tbody>` + endpointRows().filter(r=>r.status==='REMOVED').map(r => {
    const approval = (state.breaking?.breakingChanges?.removedEndpoints || []).find(e => `${String(e.method).toUpperCase()} ${e.path}` === r.id);
    const revoke = approval ? `<button class="btn danger-outline" data-revoke="${esc(r.id)}">Revogar</button>` : `<button class="btn primary" data-approve="${esc(r.id)}">Aprovar</button>`;
    return `<tr><td>${esc(r.method)}</td><td><code>${esc(r.path)}</code></td><td>${badge(r.decision)}</td><td>${esc(approval?.ticket || '-')}</td><td>${revoke}</td></tr>`;
  }).join('') + '</tbody>';

  document.querySelectorAll('[data-approve]').forEach(btn => btn.onclick = () => openApproval(btn.dataset.approve));
  document.querySelectorAll('[data-revoke]').forEach(btn => btn.onclick = () => revokeApproval(btn.dataset.revoke));
}

function openApproval(id) {
  const row = endpointRows().find(r => r.id === id);
  state.selectedRemoval = row;
  $('approvalTarget').textContent = id;
  $('approvalModal').classList.remove('hidden');
}

async function revokeApproval(id) {
  const row = endpointRows().find(r => r.id === id);
  await api('/api/endpoints/revoke-removal', { method:'POST', body: JSON.stringify({ method: row.method, path: row.path }) });
  msg('Aprovação removida.');
  await loadAll();
}

async function confirmApproval() {
  const row = state.selectedRemoval;
  await api('/api/endpoints/approve-removal', { method:'POST', body: JSON.stringify({
    method: row.method, path: row.path,
    ticket: $('approvalTicket').value,
    approvedBy: $('approvalBy').value,
    reason: $('approvalReason').value,
    replacement: $('approvalReplacement').value
  }) });
  $('approvalModal').classList.add('hidden');
  msg('Remoção aprovada em release/breaking-changes.yml');
  await loadAll();
}

async function loadAll() {
  const cfg = await api('/api/config'); state.config = cfg.config;
  state.breaking = await api('/api/breaking-changes');
  state.baseline = await api('/api/endpoints/baseline');
  state.current = await api('/api/endpoints/current');
  try { state.diff = await api('/api/endpoints/diff'); } catch(e) { state.diff = { status:'BLOCKED', summary:{}, findings:[] }; }
  $('breakingText').value = JSON.stringify(state.breaking, null, 2);
  renderForms(); renderDashboard(); renderEndpoints();
}

async function saveConfig() {
  const validation = await api('/api/config/validate', { method:'POST', body: JSON.stringify({ config: state.config }) });
  if (!validation.valid) { msg(validation.errors.join(' | '), true); return; }
  await api('/api/config/save', { method:'POST', body: JSON.stringify({ config: state.config }) });
  msg('Configuração salva com backup.');
}

async function saveBreaking() {
  let data;
  try { data = JSON.parse($('breakingText').value); } catch(e) { msg('Breaking Changes precisa estar em JSON válido nesta tela.', true); return; }
  await api('/api/breaking-changes/save', { method:'POST', body: JSON.stringify(data) });
  msg('Breaking changes salvo com backup.');
  await loadAll();
}

document.querySelectorAll('.nav').forEach(btn => btn.onclick = () => {
  document.querySelectorAll('.nav,.view').forEach(el=>el.classList.remove('active'));
  btn.classList.add('active'); $(btn.dataset.view).classList.add('active');
});
document.querySelectorAll('.filter').forEach(btn => btn.onclick = () => {
  document.querySelectorAll('.filter').forEach(el=>el.classList.remove('active'));
  btn.classList.add('active'); state.filter = btn.dataset.filter; renderEndpoints();
});
$('refreshAll').onclick = loadAll;
$('refreshEndpoints').onclick = loadAll;
$('validateConfig').onclick = async () => { const v = await api('/api/config/validate', { method:'POST', body: JSON.stringify({ config: state.config }) }); msg(v.valid ? 'Config válida.' : v.errors.join(' | '), !v.valid); };
$('saveConfig').onclick = saveConfig;
$('saveBreaking').onclick = saveBreaking;
$('confirmApproval').onclick = confirmApproval;
$('closeModal').onclick = () => $('approvalModal').classList.add('hidden');

showFileModeNotice();
loadAll().catch(e => msg(e.message, true));
