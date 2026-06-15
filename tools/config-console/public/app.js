let state = {
  config: null,
  breaking: null,
  current: null,
  baseline: null,
  diff: null,
  runtime: null,
  selectedApproval: null,
  filter: 'all',
  history: [],
  historySummary: null
};

const FILE_MODE = window.location.protocol === 'file:';
const API_ROOT = FILE_MODE ? 'http://127.0.0.1:3030' : '';
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

function showFileModeNotice() {
  if (!FILE_MODE) return;
  const box = document.createElement('div');
  box.className = 'file-mode-warning';
  box.innerHTML = `
    <strong>Console aberto via arquivo local.</strong>
    <span>Para funcionar 100%, rode <code>tools\\guardian.cmd</code> e escolha Abrir console local.</span>
    <span>Acesse <a href="http://127.0.0.1:3030">http://127.0.0.1:3030</a>.</span>
  `;
  document.body.prepend(box);
}

function msg(text, error = false) {
  const el = document.createElement('div');
  el.className = `msg ${error ? 'error' : ''}`;
  el.textContent = text;
  $('messages').prepend(el);
  setTimeout(() => el.remove(), 9000);
}

async function api(path, options = {}) {
  const url = `${API_ROOT}${path}`;
  let res;
  try {
    res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, mode: 'cors', ...options });
  } catch (error) {
    if (FILE_MODE) throw new Error('Console aberto por file://. Rode tools\\guardian.cmd e abra http://127.0.0.1:3030. Detalhe: ' + error.message);
    throw error;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || (data.errors || []).join(', ') || `HTTP ${res.status}`);
  return data;
}

function pathGet(obj, path) { return String(path).split('.').reduce((o,k)=>o?.[k], obj); }
function pathSet(obj, path, value) {
  const parts = String(path).split('.');
  let cur = obj;
  while (parts.length > 1) { const p = parts.shift(); cur[p] = cur[p] || {}; cur = cur[p]; }
  cur[parts[0]] = value;
}

function field(label, path, type = 'text') {
  const value = pathGet(state.config, path);
  if (type === 'checkbox') return `<label>${esc(label)}<input type="checkbox" data-path="${esc(path)}" ${value ? 'checked' : ''}></label>`;
  return `<label>${esc(label)}<input data-path="${esc(path)}" value="${esc(value)}"></label>`;
}

function bindInputs() {
  document.querySelectorAll('[data-path]').forEach(input => {
    input.addEventListener('change', () => {
      let value = input.type === 'checkbox' ? input.checked : input.value;
      if (input.dataset.number === 'true') value = Number(value);
      pathSet(state.config, input.dataset.path, value);
      renderDashboard();
    });
  });
}

function renderForms() {
  $('projectForm').innerHTML = [
    field('Nome técnico', 'project.name'),
    field('Nome visual', 'project.displayName'),
    field('Tipo', 'project.type'),
    field('RAML principal', 'project.mainFile'),
    field('Owner', 'project.owner'),
    field('Descrição', 'project.description')
  ].join('');

  $('exchangeForm').innerHTML = [
    field('Exchange habilitado', 'exchange.enabled', 'checkbox'),
    field('Asset ID', 'exchange.assetId'),
    field('Asset Name', 'exchange.assetName'),
    field('Descrição', 'exchange.assetDescription'),
    field('Classifier', 'exchange.classifier'),
    field('Main File', 'exchange.mainFile'),
    field('API Version', 'exchange.apiVersion'),
    field('Auto bump habilitado', 'exchange.autoBump.enabled', 'checkbox'),
    numberField('Max 409 retries', 'exchange.autoBump.max409Retries'),
    numberField('Retry 429', 'exchange.autoBump.retry429MaxAttempts'),
    numberField('Retry 5xx', 'exchange.autoBump.retry5xxMaxAttempts'),
    numberField('Backoff seconds', 'exchange.autoBump.backoffSeconds')
  ].join('');

  $('versioningForm').innerHTML = [
    field('Minor line', 'versioning.minorLine'),
    field('Initial version', 'versioning.initialVersion'),
    field('Strategy', 'versioning.strategy'),
    field('Stability default', 'versioning.stability.default'),
    field('feature/*', 'versioning.branchRules.feature/*'),
    field('develop', 'versioning.branchRules.develop'),
    field('release/next', 'versioning.branchRules.release/next'),
    field('release/current', 'versioning.branchRules.release/current'),
    field('main', 'versioning.branchRules.main'),
    field('master', 'versioning.branchRules.master')
  ].join('');

  $('contractForm').innerHTML = [
    field('Contract Guard habilitado', 'contractGuard.enabled', 'checkbox'),
    field('Baseline mode', 'contractGuard.baselineMode'),
    field('Detectar possible replacements', 'contractGuard.changeDetection.detectPossibleReplacements', 'checkbox'),
    numberField('Similarity threshold', 'contractGuard.changeDetection.similarityThreshold'),
    numberField('Strong similarity threshold', 'contractGuard.changeDetection.strongSimilarityThreshold'),
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
  $('secretList').innerHTML = secrets.map(s => `<div class="secret">${esc(s)}</div>`).join('') || '<p class="muted">Nenhum secret configurado.</p>';
  bindInputs();
}

function numberField(label, path) {
  return `<label>${esc(label)}<input data-path="${esc(path)}" data-number="true" value="${esc(pathGet(state.config, path))}"></label>`;
}

function badge(value, label = value) {
  const v = String(value || 'INFO').toUpperCase();
  let cls = 'info';
  if (v.includes('BLOCK') || v.includes('REMOVED')) cls = 'block';
  if (v.includes('WARN') || v.includes('POSSIBLE') || v.includes('REPLAC')) cls = 'warn';
  if (v.includes('OK') || v.includes('EXISTING') || v.includes('APPROVED')) cls = 'ok';
  if (v.includes('NEW')) cls = 'info';
  if (v.includes('CHANGE')) cls = 'purple';
  return `<span class="badge ${cls}">${esc(label || v)}</span>`;
}

function card(title, value, sub = '', status = 'INFO') {
  const s = String(status || '').toUpperCase();
  const cls = s.includes('BLOCK') ? 'block' : s.includes('WARN') ? 'warn' : s.includes('OK') || s.includes('READY') ? 'ok' : '';
  return `<div class="card ${cls}"><div class="card-title">${esc(title)}</div><div class="card-value">${esc(value)}</div><div class="card-subtitle">${esc(sub)}</div></div>`;
}

function getPossibleReplacements() {
  const top = state.diff?.possibleReplacements || [];
  const stable = state.diff?.stableBaselineGuard?.possibleReplacements || [];
  const git = state.diff?.gitDiffGuard?.possibleReplacements || state.diff?.gitDiffGuard?.possibleReplacementsInThisChange || [];
  const map = new Map();
  [...top, ...stable, ...git].forEach(item => {
    const key = `${item.oldMethod || item.method} ${item.oldPath || item.path}->${item.newMethod || item.method} ${item.newPath || item.replacement}`;
    map.set(key, item);
  });
  return [...map.values()];
}

function getApprovals() {
  return state.breaking?.breakingChanges || {};
}

function approvalKeyPossible(item) {
  return `${String(item.oldMethod || item.method || '').toUpperCase()} ${item.oldPath || item.path || ''}->${String(item.newMethod || item.method || '').toUpperCase()} ${item.newPath || item.replacement || ''}`;
}

function approvedPossibleSet() {
  const bc = getApprovals();
  const all = [...(bc.possibleReplacements || []), ...(bc.replacedEndpoints || []), ...(bc.changedEndpoints || [])];
  return new Set(all.map(approvalKeyPossible));
}

function renderRuntime() {
  const runtime = state.runtime || {};
  $('runtimeInfo').innerHTML = [
    `<span class="chip">Projeto: <strong>${esc(runtime.projectDir || '-')}</strong></span>`,
    `<span class="chip">Core: <strong>${esc(runtime.coreDir || '-')}</strong></span>`,
    `<span class="chip">Ref: <strong>${esc(runtime.ref || 'local')}</strong></span>`
  ].join('');
}

function renderDashboard() {
  const endpoints = state.current?.endpoints || [];
  const base = state.baseline?.endpoints || [];
  const diff = state.diff || {};
  const possible = getPossibleReplacements();
  const stability = pathGet(state.config || {}, 'versioning.stability.default') || 'draft';
  const final = diff.finalDecision?.status || diff.status || 'N/A';
  $('dashboardCards').innerHTML = [
    card('Projeto', pathGet(state.config,'project.name') || 'N/A', pathGet(state.config,'project.mainFile') || ''),
    card('Asset ID', pathGet(state.config,'exchange.assetId') || 'N/A', 'Exchange'),
    card('Stability', String(stability).toUpperCase(), 'default'),
    card('Endpoints atuais', endpoints.length, `baseline: ${base.length}`),
    card('Novos', diff.summary?.addedEndpoints ?? 0, 'permitido', 'OK'),
    card('Removidos', diff.summary?.removedEndpoints ?? 0, 'default: BLOCK', diff.summary?.removedEndpoints ? 'WARN' : 'OK'),
    card('Possible replacements', possible.length, 'sugestão inteligente', possible.length ? 'WARN' : 'OK'),
    card('Final decision', final, diff.finalDecision?.reason || 'Contract Guard', final)
  ].join('');
  $('decisionPanel').innerHTML = `
    <div class="card-title">Decisão consolidada</div>
    <div class="card-value">${badge(final, final)}</div>
    <p class="muted">${esc(diff.finalDecision?.reason || 'Execute o Contract Guard para atualizar a decisão.')}</p>
    <div class="subline">Blocks: ${esc(diff.summary?.blocks ?? 0)} • Warnings: ${esc(diff.summary?.warnings ?? 0)} • Approved: ${esc(diff.summary?.approvedWarnings ?? 0)}</div>
  `;
}

function endpointKey(e) { return `${String(e.method || '').toUpperCase()} ${e.path || ''}`.trim(); }
function getEndpointParams(e) {
  const q = Object.keys(e.queryParameters || {}).join(', ') || '-';
  const u = Object.keys(e.uriParameters || {}).join(', ') || '-';
  return `URI: ${u}<br><span class="subline">Query: ${q}</span>`;
}

function endpointRows() {
  const rows = [];
  const current = new Map((state.current?.endpoints || []).map(e => [e.id || endpointKey(e), e]));
  const baseline = new Map((state.baseline?.endpoints || []).map(e => [e.id || endpointKey(e), e]));
  const removedApproved = new Set((getApprovals().removedEndpoints || []).map(e => `${String(e.method).toUpperCase()} ${e.path}`));
  const possible = getPossibleReplacements();
  const possibleByOld = new Map(possible.map(p => [p.oldId || `${String(p.oldMethod || '').toUpperCase()} ${p.oldPath}`, p]));
  const possibleByNew = new Map(possible.map(p => [p.newId || `${String(p.newMethod || '').toUpperCase()} ${p.newPath}`, p]));
  const possibleApproved = approvedPossibleSet();

  for (const id of new Set([...current.keys(), ...baseline.keys()])) {
    const cur = current.get(id); const base = baseline.get(id); const endpoint = cur || base;
    let status = cur && base ? 'EXISTING' : cur ? 'NEW' : 'REMOVED';
    const oldPossible = possibleByOld.get(id);
    const newPossible = possibleByNew.get(id);
    let decision = status === 'REMOVED' ? (removedApproved.has(id) ? 'APPROVED_REMOVAL' : 'BLOCK') : 'OK';
    if (oldPossible) {
      status = 'POSSIBLE_REPLACEMENT';
      decision = possibleApproved.has(approvalKeyPossible(oldPossible)) || oldPossible.approvalStatus === 'APPROVED' ? 'APPROVED_REPLACEMENT' : 'BLOCK';
    }
    if (newPossible && status === 'NEW') status = 'NEW_RELATED';
    rows.push({ status, method:endpoint.method, path:endpoint.path, id, decision, endpoint, possible: oldPossible || newPossible || null });
  }
  return rows.sort((a,b)=>a.id.localeCompare(b.id));
}

function shouldShow(row) {
  const f = state.filter;
  if (f === 'all') return true;
  if (f === 'new') return row.status.startsWith('NEW');
  if (f === 'removed') return row.status === 'REMOVED';
  if (f === 'changed') return row.status.includes('CHANGE');
  if (f === 'possible') return row.status === 'POSSIBLE_REPLACEMENT';
  if (f === 'blocked') return row.decision === 'BLOCK';
  if (f === 'approved') return row.decision.includes('APPROVED');
  return true;
}

function renderEndpoints() {
  const rows = endpointRows().filter(shouldShow);
  $('endpointTable').innerHTML = `<thead><tr><th>Status</th><th>Method</th><th>Path</th><th>Params</th><th>Responses</th><th>Decision</th><th>Ação</th></tr></thead><tbody>` + rows.map(r => {
    const e = r.endpoint;
    const res = Object.keys(e.responses || {}).join(', ') || '-';
    let related = '';
    if (r.possible) {
      related = `<div class="subline">${r.status === 'POSSIBLE_REPLACEMENT' ? 'Possível novo endpoint' : 'Relacionado ao removido'}: <code>${esc(r.status === 'POSSIBLE_REPLACEMENT' ? r.possible.newId : r.possible.oldId)}</code> • Similaridade ${esc(r.possible.similarityScore || 0)}%</div>`;
    }
    const action = r.status === 'REMOVED' || r.status === 'POSSIBLE_REPLACEMENT'
      ? `<button class="btn small primary" data-approve-row="${esc(r.id)}">Aprovar</button>`
      : '-';
    return `<tr><td>${badge(r.status)}</td><td>${esc(r.method)}</td><td class="path-cell"><code>${esc(r.path)}</code>${related}</td><td>${getEndpointParams(e)}</td><td>${esc(res)}</td><td>${badge(r.decision)}</td><td>${action}</td></tr>`;
  }).join('') + '</tbody>';

  renderPossibleReplacements();
  renderApprovalTable();
  document.querySelectorAll('[data-approve-row]').forEach(btn => btn.onclick = () => openApprovalFromRow(btn.dataset.approveRow));
}

function renderPossibleReplacements() {
  const possible = getPossibleReplacements();
  $('possibleTable').innerHTML = `<thead><tr><th>Old endpoint</th><th>New endpoint</th><th>Similarity</th><th>Decision</th><th>Approval</th><th>Ação</th></tr></thead><tbody>` + (possible.length ? possible.map((p, idx) => {
    const approved = approvedPossibleSet().has(approvalKeyPossible(p)) || p.approvalStatus === 'APPROVED';
    return `<tr><td><strong>${esc(p.oldMethod)}</strong><br><code>${esc(p.oldPath)}</code></td><td><strong>${esc(p.newMethod)}</strong><br><code>${esc(p.newPath)}</code></td><td><div class="score"><span style="width:${Math.max(0, Math.min(100, Number(p.similarityScore || 0)))}%"></span></div><div class="subline">${esc(p.similarityScore || 0)}% • ${(p.similarityReasons || []).map(esc).join(', ')}</div></td><td>${badge(approved ? 'WARN' : 'BLOCK', approved ? 'WARN' : 'BLOCK')}</td><td>${badge(approved ? 'APPROVED' : 'NOT_APPROVED')}</td><td><button class="btn small primary" data-approve-possible="${idx}">Aprovar</button></td></tr>`;
  }).join('') : '<tr><td colspan="6" class="muted">Nenhum possible replacement detectado.</td></tr>') + '</tbody>';
  document.querySelectorAll('[data-approve-possible]').forEach(btn => btn.onclick = () => openApprovalFromPossible(possible[Number(btn.dataset.approvePossible)]));
}

function renderApprovalTable() {
  const approvalRows = endpointRows().filter(r => r.status === 'REMOVED' || r.status === 'POSSIBLE_REPLACEMENT');
  $('approvalTable').innerHTML = `<thead><tr><th>Type</th><th>Old</th><th>New / replacement</th><th>Decision</th><th>Ticket</th><th>Ação</th></tr></thead><tbody>` + (approvalRows.length ? approvalRows.map(r => {
    const p = r.possible;
    const bc = getApprovals();
    const removed = (bc.removedEndpoints || []).find(e => `${String(e.method).toUpperCase()} ${e.path}` === r.id);
    const possibleApproval = p ? [...(bc.possibleReplacements || []), ...(bc.replacedEndpoints || []), ...(bc.changedEndpoints || [])].find(e => approvalKeyPossible(e) === approvalKeyPossible(p)) : null;
    const approval = removed || possibleApproval;
    const revokePayload = p ? approvalKeyPossible(p) : r.id;
    const revoke = approval ? `<button class="btn small danger-outline" data-revoke="${esc(revokePayload)}">Revogar</button>` : `<button class="btn small primary" data-approve-row="${esc(r.id)}">Aprovar</button>`;
    return `<tr><td>${badge(p ? 'POSSIBLE_REPLACEMENT' : 'REMOVED')}</td><td><strong>${esc(r.method)}</strong><br><code>${esc(r.path)}</code></td><td>${p ? `<strong>${esc(p.newMethod)}</strong><br><code>${esc(p.newPath)}</code>` : esc(approval?.replacement || '-')}</td><td>${badge(r.decision)}</td><td>${esc(approval?.ticket || '-')}</td><td>${revoke}</td></tr>`;
  }).join('') : '<tr><td colspan="6" class="muted">Nenhum breaking change pendente.</td></tr>') + '</tbody>';
  document.querySelectorAll('[data-approve-row]').forEach(btn => btn.onclick = () => openApprovalFromRow(btn.dataset.approveRow));
  document.querySelectorAll('[data-revoke]').forEach(btn => btn.onclick = () => revokeApproval(btn.dataset.revoke));
}


function renderHistory() {
  const events = state.history || [];
  const summary = state.historySummary || {};
  const byType = summary.byType || {};
  const byDecision = summary.byDecision || {};
  const actorCount = Object.keys(summary.byActor || {}).length;
  const blocks = (byDecision.BLOCK || byDecision.BLOCKED || 0);
  const approvals = Object.entries(byType).filter(([k]) => k.includes('APPROVAL') || k.includes('APPROVED')).reduce((acc, [,v]) => acc + Number(v || 0), 0);
  if ($('historyCards')) {
    $('historyCards').innerHTML = [
      card('Eventos', summary.total || events.length || 0, 'INFO', 'histórico auditável'),
      card('Atores', actorCount, 'INFO', 'usuários Git/CI'),
      card('Aprovações', approvals, approvals ? 'WARN' : 'OK', 'criadas/revogadas'),
      card('Blocks', blocks, blocks ? 'BLOCKED' : 'OK', 'mudanças bloqueadas')
    ].join('');
  }
  if (!$('historyTable')) return;
  $('historyTable').innerHTML = `<thead><tr><th>Data</th><th>Evento</th><th>Endpoint / mudança</th><th>Decisão</th><th>Ticket</th><th>Usuário Git/CI</th><th>Branch / commit</th></tr></thead><tbody>` + (events.length ? events.map(e => {
    const oldEndpoint = e.oldPath ? `${e.oldMethod || ''} ${e.oldPath}`.trim() : '';
    const newEndpoint = e.newPath ? `${e.newMethod || ''} ${e.newPath}`.trim() : '';
    const endpoint = e.path ? `${e.method || ''} ${e.path}`.trim() : '';
    const change = oldEndpoint || newEndpoint
      ? `<code>${esc(oldEndpoint || '-')}</code><br><span class="subline">→ <code>${esc(newEndpoint || '-')}</code>${e.similarityScore ? ` • ${esc(e.similarityScore)}%` : ''}</span>`
      : endpoint ? `<code>${esc(endpoint)}</code>` : `<span class="muted">${esc(e.message || e.changeType || '-')}</span>`;
    const actor = `${esc(e.actor?.name || '-')}<br><span class="subline">${esc(e.actor?.email || e.actor?.gitUserEmail || '')}</span>`;
    const git = `${esc(e.git?.branch || '-')}<br><span class="subline mono">${esc(e.git?.commitShort || '')}</span>`;
    return `<tr><td>${esc(e.createdAt || '')}</td><td>${badge(e.eventType || 'EVENT')}</td><td>${change}</td><td>${badge(e.decision || e.severity || 'INFO')}</td><td>${esc(e.ticket || '-')}<br><span class="subline">${esc(e.reason || '')}</span></td><td>${actor}</td><td>${git}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="muted">Nenhum evento histórico ainda. Rode o Contract Guard ou aprove uma alteração para gerar histórico.</td></tr>') + '</tbody>';
}

function openApprovalFromRow(id) {
  const row = endpointRows().find(r => r.id === id);
  if (!row) return;
  if (row.possible && row.status === 'POSSIBLE_REPLACEMENT') return openApprovalFromPossible(row.possible);
  state.selectedApproval = { type: 'removedEndpoint', method: row.method, path: row.path };
  $('approvalTitle').textContent = 'Aprovar remoção de endpoint';
  $('approvalTarget').innerHTML = `<code>${esc(row.id)}</code>`;
  $('approvalType').value = 'removedEndpoint';
  $('approvalReplacement').value = '';
  $('approvalModal').classList.remove('hidden');
}

function openApprovalFromPossible(p) {
  state.selectedApproval = { type: 'possibleReplacement', ...p };
  $('approvalTitle').textContent = 'Aprovar possible replacement';
  $('approvalTarget').innerHTML = `<code>${esc(p.oldId || `${p.oldMethod} ${p.oldPath}`)}</code><br>→ <code>${esc(p.newId || `${p.newMethod} ${p.newPath}`)}</code><br><span class="subline">Similaridade ${esc(p.similarityScore || 0)}%</span>`;
  $('approvalType').value = 'possibleReplacement';
  $('approvalReplacement').value = p.newPath || '';
  $('approvalModal').classList.remove('hidden');
}

async function revokeApproval(key) {
  const possible = getPossibleReplacements().find(p => approvalKeyPossible(p) === key);
  const row = endpointRows().find(r => r.id === key);
  const body = possible ? { oldMethod: possible.oldMethod, oldPath: possible.oldPath, newMethod: possible.newMethod, newPath: possible.newPath } : { method: row?.method || key.split(' ')[0], path: row?.path || key.replace(/^\S+\s+/, '') };
  await api('/api/breaking-changes/revoke', { method:'POST', body: JSON.stringify(body) });
  msg('Aprovação removida.');
  await loadAll();
}

async function confirmApproval() {
  const selected = state.selectedApproval;
  if (!selected) return;
  const type = $('approvalType').value;
  const common = {
    type,
    ticket: $('approvalTicket').value.trim(),
    approvedBy: $('approvalBy').value.trim(),
    reason: $('approvalReason').value.trim(),
    notes: $('approvalNotes').value.trim(),
    replacement: $('approvalReplacement').value.trim()
  };
  let body;
  if (selected.oldPath || type !== 'removedEndpoint') {
    body = {
      ...common,
      oldMethod: selected.oldMethod || selected.method,
      oldPath: selected.oldPath || selected.path,
      newMethod: selected.newMethod || selected.method,
      newPath: common.replacement || selected.newPath,
      similarityScore: selected.similarityScore || 0
    };
  } else {
    body = { ...common, method: selected.method, path: selected.path };
  }
  await api('/api/breaking-changes/approve', { method:'POST', body: JSON.stringify(body) });
  $('approvalModal').classList.add('hidden');
  msg('Breaking change aprovado em release/breaking-changes.yml');
  clearModal();
  await loadAll();
}

function clearModal() {
  ['approvalTicket','approvalBy','approvalReason','approvalReplacement','approvalNotes'].forEach(id => { $(id).value = ''; });
  state.selectedApproval = null;
}

async function loadAll() {
  const cfg = await api('/api/config');
  state.config = cfg.config;
  state.runtime = cfg.runtime || {};
  state.breaking = await api('/api/breaking-changes');
  state.baseline = await api('/api/endpoints/baseline');
  state.current = await api('/api/endpoints/current');
  try { state.diff = await api('/api/endpoints/diff'); } catch(e) { state.diff = { status:'BLOCKED', summary:{}, findings:[], possibleReplacements:[] }; }
  try { const hist = await api('/api/history?limit=300'); state.history = hist.events || []; state.historySummary = hist.summary || {}; } catch(e) { state.history = []; state.historySummary = {}; }
  $('breakingText').value = JSON.stringify(state.breaking, null, 2);
  renderRuntime(); renderForms(); renderDashboard(); renderEndpoints(); renderHistory();
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

function bindUi() {
  document.querySelectorAll('.nav').forEach(btn => btn.onclick = () => {
    document.querySelectorAll('.nav,.view').forEach(el=>el.classList.remove('active'));
    btn.classList.add('active'); $(btn.dataset.view).classList.add('active');
    $('sidebar').classList.remove('open');
  });
  document.querySelectorAll('.filter').forEach(btn => btn.onclick = () => {
    document.querySelectorAll('.filter').forEach(el=>el.classList.remove('active'));
    btn.classList.add('active'); state.filter = btn.dataset.filter; renderEndpoints();
  });
  $('toggleNav').onclick = () => $('sidebar').classList.toggle('open');
  $('refreshAll').onclick = loadAll;
  $('refreshEndpoints').onclick = loadAll;
  if ($('refreshHistory')) $('refreshHistory').onclick = loadAll;
  $('validateConfig').onclick = async () => { const v = await api('/api/config/validate', { method:'POST', body: JSON.stringify({ config: state.config }) }); msg(v.valid ? 'Config válida.' : v.errors.join(' | '), !v.valid); };
  $('saveConfig').onclick = saveConfig;
  $('saveBreaking').onclick = saveBreaking;
  $('confirmApproval').onclick = () => confirmApproval().catch(e => msg(e.message, true));
  $('closeModal').onclick = () => { $('approvalModal').classList.add('hidden'); clearModal(); };
  $('cancelApproval').onclick = () => { $('approvalModal').classList.add('hidden'); clearModal(); };
  $('approvalModal').addEventListener('click', (event) => { if (event.target.id === 'approvalModal') { $('approvalModal').classList.add('hidden'); clearModal(); } });
}

showFileModeNotice();
bindUi();
loadAll().catch(e => msg(e.message, true));
