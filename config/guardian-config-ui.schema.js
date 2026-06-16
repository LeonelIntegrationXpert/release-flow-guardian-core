const DEFAULT_CONFIG = {
  project: {
    name: 'mule-tlf-com-test',
    displayName: 'Mule TLF COM Test',
    type: 'raml-api',
    mainFile: 'api.raml',
    owner: 'leonel.d.porto@accenture.com',
    description: 'API RAML protegida pelo Release Flow Guardian.'
  },
  exchange: {
    enabled: true,
    assetId: 'mule-tlf-com-test',
    assetName: 'Mule TLF COM Test',
    assetDescription: 'API RAML protegida pelo Release Flow Guardian.',
    groupIdEnv: 'EXCHANGE_GROUP_ID',
    hostEnv: 'ANYPOINT_HOST',
    orgEnv: 'ANYPOINT_ORG',
    clientIdEnv: 'ANYPOINT_CONNECTED_APP_CLIENT_ID',
    clientSecretEnv: 'ANYPOINT_CONNECTED_APP_CLIENT_SECRET',
    classifier: 'raml',
    mainFile: 'api.raml',
    apiVersion: 'v1',
    autoBump: {
      enabled: true,
      max409Retries: 3,
      retry429MaxAttempts: 3,
      retry5xxMaxAttempts: 3,
      backoffSeconds: 10
    }
  },
  versioning: {
    minorLine: '1.0',
    initialVersion: '1.0.0',
    strategy: 'patch-auto-bump',
    stability: {
      enabled: true,
      default: 'draft',
      allowed: ['draft', 'beta', 'rc', 'stable', 'deprecated']
    },
    branchRules: {
      'feature/*': 'draft',
      develop: 'beta',
      'release/next': 'beta',
      'release/current': 'rc',
      main: 'stable',
      master: 'stable'
    }
  },
  contractGuard: {
    enabled: true,
    baselineMode: 'stable-only',
    baselineFile: 'release/api-contract-baseline.json',
    currentContractFile: 'dist/api-contract-current.json',
    diffFile: 'dist/api-contract-diff.json',
    breakingChangesFile: 'release/breaking-changes.yml',
    changeDetection: {
      enabled: true,
      detectPossibleReplacements: true,
      similarityThreshold: 70,
      strongSimilarityThreshold: 85,
      sameMethodWeight: 25,
      pathSimilarityWeight: 25,
      sameFirstSegmentWeight: 15,
      sameVersionWeight: 10,
      uriParamsSimilarityWeight: 10,
      queryParamsSimilarityWeight: 10,
      responsesSimilarityWeight: 5
    },
    defaultBehavior: {
      newEndpoint: 'ok',
      removedEndpoint: 'block',
      possibleReplacement: 'block',
      replacedEndpointWithoutApproval: 'block',
      changedBreakingEndpoint: 'block',
      changedNonBreakingEndpoint: 'warn',
      approvedBreakingChange: 'warn'
    },
    blockRemovedEndpoints: true,
    blockRemovedMethods: true,
    blockRemovedRequiredQueryParams: true,
    blockRemovedUriParams: true,
    blockRemovedSuccessResponses: true,
    blockRemovedSecurity: true,
    blockRemovedTraits: true,
    allowApprovedBreakingChanges: true
  },
  endpointGovernance: {
    enabled: true,
    inventoryEnabled: true,
    showCurrentEndpoints: true,
    showBaselineEndpoints: true,
    showRemovedEndpoints: true,
    showNewEndpoints: true,
    showChangedEndpoints: true,
    showPossibleReplacements: true,
    allowRemovalApprovalFromUi: true,
    allowChangeApprovalFromUi: true,
    allowReplacementApprovalFromUi: true,
    allowDirectRamlDeleteFromUi: false,
    requireTicketForApproval: true,
    requireApproverForApproval: true,
    requireReasonForApproval: true,
    approvedBreakingChangeDecision: 'warn',
    unapprovedBreakingChangeDecision: 'block'
  },
  restore: {
    enabled: true,
    requireConfirmation: true,
    confirmationText: 'CONFIRMO RESTAURAR CONTRATO',
    createBackupBeforeRestore: true,
    backupDir: 'release/backups',
    allowRestoreEndpointPath: true,
    allowRestoreEndpointBlock: true,
    allowRestoreMethod: false,
    allowRestoreParams: true,
    allowRestoreResponses: true,
    runValidationAfterRestore: true,
    runContractGuardAfterRestore: true,
    revokeApprovalAfterRestoreDefault: true
  },
  reports: {
    enabled: true,
    outputDir: 'dist',
    html: true,
    json: true,
    markdown: true,
    style: 'dark-neon',
    includeContractInventory: true,
    includeEndpointGovernance: true,
    includeBreakingChangeIntelligence: true,
    includeExchangeDetails: true,
    includeVersionStability: true,
    includeBranchInfo: true,
    includeCommitInfo: true,
    includeBreakingChanges: true,
    includeChangeHistory: true,
    includeActionChecklist: true
  },
  history: {
    enabled: true,
    file: 'release/history/contract-change-history.jsonl',
    includeGitUser: true,
    includeCiUser: true,
    includeBranch: true,
    includeCommit: true,
    includeCommitMessage: true,
    includeChangedFiles: true,
    includeTimestamp: true
  },
  pipelines: {
    githubActions: { enabled: true, publishBranches: ['main', 'master'], validateOnPullRequest: true, concurrencyEnabled: true },
    azureDevOps: { enabled: true, publishBranches: ['main', 'master'], validateOnPullRequest: true, exclusiveLockRecommended: true }
  },
  security: {
    neverStoreSecretsInRepo: true,
    requiredSecrets: ['ANYPOINT_CONNECTED_APP_CLIENT_ID', 'ANYPOINT_CONNECTED_APP_CLIENT_SECRET', 'ANYPOINT_ORG', 'ANYPOINT_HOST', 'EXCHANGE_GROUP_ID']
  }
};

function deepMerge(base, override) {
  if (Array.isArray(base)) return Array.isArray(override) ? override : [...base];
  if (!base || typeof base !== 'object') return override === undefined || override === null || override === '' ? base : override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) out[key] = deepMerge(base[key], value);
    else if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}

const OPTIONS = {
  baselineMode: [
    { value: 'stable-only', label: 'stable-only', help: 'Usa o baseline oficial aprovado. Recomendado para produção.' },
    { value: 'git-base-only', label: 'git-base-only', help: 'Compara apenas com branch base/commit anterior. Útil para diagnóstico.' },
    { value: 'stable-and-git', label: 'stable-and-git', help: 'Usa baseline stable e git diff. Recomendado para fluxo premium.' },
    { value: 'disabled', label: 'disabled', help: 'Desativa baseline guard. Não recomendado.' }
  ],
  decision: [
    { value: 'ok', label: 'OK' },
    { value: 'warn', label: 'WARN' },
    { value: 'block', label: 'BLOCK' }
  ],
  reportStyle: ['dark-neon', 'enterprise-dark', 'light', 'compact', 'executive'],
  stability: ['draft', 'beta', 'rc', 'stable', 'deprecated'],
  versioningStrategy: ['patch-auto-bump', 'manual', 'calendar', 'semantic'],
  classifier: ['raml', 'oas', 'http', 'custom'],
  apiVersion: ['v1', 'v2', 'v3']
};

function field(path, label, type, group, defaults = {}) {
  return {
    path,
    label,
    type,
    group,
    default: defaults.default,
    min: defaults.min,
    max: defaults.max,
    step: defaults.step || 1,
    options: defaults.options || [],
    placeholder: defaults.placeholder || '',
    description: defaults.description || '',
    help: defaults.help || '',
    impact: defaults.impact || '',
    severity: defaults.severity || 'info',
    order: defaults.order || 0
  };
}

const CONFIG_UI_SCHEMA = {
  groups: [
    { id: 'project', title: 'Projeto', description: 'Identidade da interface consumidora.', icon: '▣' },
    { id: 'exchange', title: 'Exchange', description: 'Asset, API Version e publicação no Anypoint Exchange.', icon: '⇄' },
    { id: 'versioning', title: 'Versionamento', description: 'Versão, branch rules e stability.', icon: '◇' },
    { id: 'guard-mode', title: 'Guard Mode', description: 'Liga/desliga o Contract Guard e define a fonte da verdade.', icon: '🛡' },
    { id: 'change-detection', title: 'Change Detection', description: 'Detecta possible replacements e mudanças semânticas no contrato.', icon: '⌁' },
    { id: 'blocking-rules', title: 'Blocking Rules', description: 'O que deve bloquear o fluxo quando removido/alterado.', icon: '⛔' },
    { id: 'default-decisions', title: 'Default Decisions', description: 'Decisão padrão para cada tipo de mudança.', icon: '⚙' },
    { id: 'similarity-weights', title: 'Similarity Weights', description: 'Pesos usados para calcular similaridade de possible replacements.', icon: '%' },
    { id: 'restore', title: 'Restore', description: 'Configuração para restaurar contrato a partir do baseline.', icon: '↩' },
    { id: 'history', title: 'History', description: 'Auditoria de alterações, aprovações, usuário Git/CI e decisões.', icon: '🧾' },
    { id: 'reports', title: 'Reports', description: 'Formato e conteúdo dos reports gerados.', icon: '📊' }
  ],
  fields: [
    field('project.name', 'Nome técnico', 'text', 'project', { default: DEFAULT_CONFIG.project.name, description: 'Nome técnico do projeto.', help: 'Usado no report e nos metadados internos.' }),
    field('project.displayName', 'Nome visual', 'text', 'project', { default: DEFAULT_CONFIG.project.displayName, description: 'Nome amigável da interface.' }),
    field('project.type', 'Tipo do projeto', 'select', 'project', { default: 'raml-api', options: ['raml-api'], description: 'Tipo de contrato suportado pelo Guardian.' }),
    field('project.mainFile', 'RAML principal', 'text', 'project', { default: 'api.raml', description: 'Arquivo RAML de entrada.', help: 'Normalmente api.raml.' }),
    field('project.owner', 'Owner', 'text', 'project', { default: DEFAULT_CONFIG.project.owner, description: 'Responsável técnico pelo contrato.' }),
    field('project.description', 'Descrição', 'textarea', 'project', { default: DEFAULT_CONFIG.project.description, description: 'Descrição curta da API.' }),

    field('exchange.enabled', 'Exchange habilitado', 'boolean', 'exchange', { default: true, description: 'Controla se o fluxo pode publicar no Exchange.' }),
    field('exchange.assetId', 'Asset ID', 'text', 'exchange', { default: DEFAULT_CONFIG.exchange.assetId, description: 'Identificador técnico do asset no Exchange.' }),
    field('exchange.assetName', 'Asset Name', 'text', 'exchange', { default: DEFAULT_CONFIG.exchange.assetName, description: 'Nome exibido do asset.' }),
    field('exchange.classifier', 'Classifier', 'select', 'exchange', { default: 'raml', options: OPTIONS.classifier, description: 'Tipo de pacote publicado no Exchange.' }),
    field('exchange.apiVersion', 'API Version', 'select', 'exchange', { default: 'v1', options: OPTIONS.apiVersion, description: 'Versão funcional da API no Exchange.' }),
    field('exchange.mainFile', 'Main File', 'text', 'exchange', { default: 'api.raml', description: 'Arquivo principal do pacote Exchange.' }),
    field('exchange.autoBump.enabled', 'Auto bump habilitado', 'boolean', 'exchange', { default: true, description: 'Resolve automaticamente próxima versão patch.' }),
    field('exchange.autoBump.max409Retries', 'Max 409 retries', 'number', 'exchange', { default: 3, min: 0, max: 10, description: 'Tentativas de auto bump em conflito 409.' }),
    field('exchange.autoBump.retry429MaxAttempts', 'Retry 429', 'number', 'exchange', { default: 3, min: 0, max: 10, description: 'Tentativas em rate limit.' }),
    field('exchange.autoBump.retry5xxMaxAttempts', 'Retry 5xx', 'number', 'exchange', { default: 3, min: 0, max: 10, description: 'Tentativas em erro transitório 5xx.' }),
    field('exchange.autoBump.backoffSeconds', 'Backoff seconds', 'number', 'exchange', { default: 10, min: 0, max: 120, description: 'Tempo entre retentativas.' }),

    field('versioning.minorLine', 'Minor line', 'text', 'versioning', { default: '1.0', description: 'Linha minor usada no auto bump.', help: 'Formato x.y, exemplo 1.0.' }),
    field('versioning.initialVersion', 'Initial version', 'text', 'versioning', { default: '1.0.0', description: 'Primeira versão publicada se asset não existir.' }),
    field('versioning.strategy', 'Versioning strategy', 'select', 'versioning', { default: 'patch-auto-bump', options: OPTIONS.versioningStrategy, description: 'Estratégia de versionamento.' }),
    field('versioning.stability.default', 'Stability default', 'select', 'versioning', { default: 'draft', options: OPTIONS.stability, description: 'Status padrão da versão.' }),
    field('versioning.branchRules.feature/*', 'feature/*', 'select', 'versioning', { default: 'draft', options: OPTIONS.stability, description: 'Stability para branches feature.' }),
    field('versioning.branchRules.develop', 'develop', 'select', 'versioning', { default: 'beta', options: OPTIONS.stability, description: 'Stability da branch develop.' }),
    field('versioning.branchRules.release/next', 'release/next', 'select', 'versioning', { default: 'beta', options: OPTIONS.stability, description: 'Stability da próxima release.' }),
    field('versioning.branchRules.release/current', 'release/current', 'select', 'versioning', { default: 'rc', options: OPTIONS.stability, description: 'Stability da release corrente.' }),
    field('versioning.branchRules.main', 'main', 'select', 'versioning', { default: 'stable', options: OPTIONS.stability, description: 'Main deve ser stable.' }),
    field('versioning.branchRules.master', 'master', 'select', 'versioning', { default: 'stable', options: OPTIONS.stability, description: 'Master deve ser stable.' }),

    field('contractGuard.enabled', 'Contract Guard habilitado', 'boolean', 'guard-mode', { default: true, description: 'Protege o contrato RAML contra perdas acidentais.' }),
    field('contractGuard.baselineMode', 'Baseline mode', 'select', 'guard-mode', { default: 'stable-only', options: OPTIONS.baselineMode, description: 'Fonte principal de comparação do contrato.', help: 'Recomendado: stable-only ou stable-and-git.' }),
    field('contractGuard.allowApprovedBreakingChanges', 'Permitir breaking change aprovada', 'boolean', 'guard-mode', { default: true, description: 'Permite seguir com WARN quando existe aprovação explícita.' }),

    field('contractGuard.changeDetection.enabled', 'Change detection habilitado', 'boolean', 'change-detection', { default: true, description: 'Ativa análise inteligente de mudanças.' }),
    field('contractGuard.changeDetection.detectPossibleReplacements', 'Detectar possible replacements', 'boolean', 'change-detection', { default: true, description: 'Relaciona REMOVED + NEW parecido como possível alteração/substituição.' }),
    field('contractGuard.changeDetection.similarityThreshold', 'Similarity threshold', 'number', 'change-detection', { default: 70, min: 0, max: 100, description: 'Score mínimo para sugerir POSSIBLE_REPLACEMENT.', help: 'Valores baixos detectam mais possibilidades, mas podem gerar falsos positivos.', impact: 'Afeta a detecção de possible replacements.' }),
    field('contractGuard.changeDetection.strongSimilarityThreshold', 'Strong similarity threshold', 'number', 'change-detection', { default: 85, min: 0, max: 100, description: 'Score mínimo para sugestão forte.', help: 'Deve ser maior ou igual ao threshold normal.' }),

    field('contractGuard.blockRemovedEndpoints', 'Bloquear endpoint removido', 'boolean', 'blocking-rules', { default: true, description: 'Bloqueia endpoint removido sem aprovação.' }),
    field('contractGuard.blockRemovedMethods', 'Bloquear método removido', 'boolean', 'blocking-rules', { default: true, description: 'Bloqueia método removido sem aprovação.' }),
    field('contractGuard.blockRemovedRequiredQueryParams', 'Bloquear query param obrigatório removido', 'boolean', 'blocking-rules', { default: true, description: 'Bloqueia remoção de query param obrigatório.' }),
    field('contractGuard.blockRemovedUriParams', 'Bloquear URI param removido', 'boolean', 'blocking-rules', { default: true, description: 'Bloqueia remoção/renomeação de URI param.' }),
    field('contractGuard.blockRemovedSuccessResponses', 'Bloquear response sucesso removida', 'boolean', 'blocking-rules', { default: true, description: 'Bloqueia remoção de 200/201/202.' }),
    field('contractGuard.blockRemovedSecurity', 'Bloquear security removida', 'boolean', 'blocking-rules', { default: true, description: 'Bloqueia perda de security scheme.' }),
    field('contractGuard.blockRemovedTraits', 'Bloquear trait removida', 'boolean', 'blocking-rules', { default: true, description: 'Bloqueia perda de trait aplicada.' }),

    field('contractGuard.defaultBehavior.newEndpoint', 'Novo endpoint', 'select', 'default-decisions', { default: 'ok', options: OPTIONS.decision, description: 'Decisão para endpoint novo.' }),
    field('contractGuard.defaultBehavior.removedEndpoint', 'Endpoint removido', 'select', 'default-decisions', { default: 'block', options: OPTIONS.decision, description: 'Decisão para endpoint removido sem aprovação.' }),
    field('contractGuard.defaultBehavior.possibleReplacement', 'Possible replacement', 'select', 'default-decisions', { default: 'block', options: OPTIONS.decision, description: 'Decisão para alteração/substituição provável sem aprovação.' }),
    field('contractGuard.defaultBehavior.replacedEndpointWithoutApproval', 'Replacement sem aprovação', 'select', 'default-decisions', { default: 'block', options: OPTIONS.decision, description: 'Decisão para endpoint substituído sem aprovação.' }),
    field('contractGuard.defaultBehavior.changedBreakingEndpoint', 'Breaking change', 'select', 'default-decisions', { default: 'block', options: OPTIONS.decision, description: 'Decisão para alteração breaking.' }),
    field('contractGuard.defaultBehavior.changedNonBreakingEndpoint', 'Non-breaking change', 'select', 'default-decisions', { default: 'warn', options: OPTIONS.decision, description: 'Decisão para alteração não breaking.' }),
    field('contractGuard.defaultBehavior.approvedBreakingChange', 'Breaking change aprovada', 'select', 'default-decisions', { default: 'warn', options: OPTIONS.decision, description: 'Decisão para breaking change aprovada.' }),

    field('contractGuard.changeDetection.sameMethodWeight', 'Method weight', 'number', 'similarity-weights', { default: 25, min: 0, max: 100, description: 'Peso para método igual.' }),
    field('contractGuard.changeDetection.pathSimilarityWeight', 'Path similarity weight', 'number', 'similarity-weights', { default: 25, min: 0, max: 100, description: 'Peso para similaridade textual do path.' }),
    field('contractGuard.changeDetection.sameFirstSegmentWeight', 'First segment weight', 'number', 'similarity-weights', { default: 15, min: 0, max: 100, description: 'Peso para mesma família de path.' }),
    field('contractGuard.changeDetection.sameVersionWeight', 'Version weight', 'number', 'similarity-weights', { default: 10, min: 0, max: 100, description: 'Peso para mesma versão base.' }),
    field('contractGuard.changeDetection.uriParamsSimilarityWeight', 'URI params weight', 'number', 'similarity-weights', { default: 10, min: 0, max: 100, description: 'Peso para URI params similares.' }),
    field('contractGuard.changeDetection.queryParamsSimilarityWeight', 'Query params weight', 'number', 'similarity-weights', { default: 10, min: 0, max: 100, description: 'Peso para query params similares.' }),
    field('contractGuard.changeDetection.responsesSimilarityWeight', 'Responses weight', 'number', 'similarity-weights', { default: 5, min: 0, max: 100, description: 'Peso para responses similares.' }),

    field('restore.enabled', 'Restore habilitado', 'boolean', 'restore', { default: true, description: 'Permite restaurar contrato a partir do baseline.' }),
    field('restore.confirmationText', 'Texto de confirmação', 'text', 'restore', { default: DEFAULT_CONFIG.restore.confirmationText, description: 'Texto obrigatório antes de restaurar contrato.' }),
    field('restore.createBackupBeforeRestore', 'Backup antes do restore', 'boolean', 'restore', { default: true, description: 'Cria backup antes de alterar RAML.' }),
    field('restore.backupDir', 'Diretório de backup', 'text', 'restore', { default: 'release/backups', description: 'Pasta onde backups serão salvos.' }),
    field('restore.allowRestoreEndpointPath', 'Restaurar path', 'boolean', 'restore', { default: true, description: 'Permite restaurar path do endpoint.' }),
    field('restore.allowRestoreEndpointBlock', 'Restaurar bloco de endpoint', 'boolean', 'restore', { default: true, description: 'Permite restaurar bloco RAML completo a partir de release/baseline/api.raml.' }),
    field('restore.allowRestoreMethod', 'Restaurar método', 'boolean', 'restore', { default: false, description: 'Permite restaurar método HTTP.' }),
    field('restore.allowRestoreParams', 'Restaurar params', 'boolean', 'restore', { default: true, description: 'Permite restaurar parâmetros.' }),
    field('restore.allowRestoreResponses', 'Restaurar responses', 'boolean', 'restore', { default: true, description: 'Permite restaurar responses.' }),
    field('restore.runValidationAfterRestore', 'Validar após restore', 'boolean', 'restore', { default: true, description: 'Roda extração/validação de contrato depois do restore.' }),
    field('restore.runContractGuardAfterRestore', 'Rodar Contract Guard após restore', 'boolean', 'restore', { default: true, description: 'Recalcula a decisão após restaurar.' }),
    field('restore.revokeApprovalAfterRestoreDefault', 'Revogar approval após restore', 'boolean', 'restore', { default: true, description: 'Sugere revogar approval relacionado quando o contrato é restaurado.' }),

    field('history.enabled', 'Histórico habilitado', 'boolean', 'history', { default: true, description: 'Registra trilha auditável de contrato.' }),
    field('history.file', 'Arquivo de histórico', 'text', 'history', { default: DEFAULT_CONFIG.history.file, description: 'Arquivo JSONL de auditoria.' }),
    field('history.includeGitUser', 'Incluir usuário Git', 'boolean', 'history', { default: true, description: 'Registra nome/e-mail do Git.' }),
    field('history.includeCiUser', 'Incluir usuário CI', 'boolean', 'history', { default: true, description: 'Registra usuário de pipeline quando disponível.' }),
    field('history.includeBranch', 'Incluir branch', 'boolean', 'history', { default: true, description: 'Registra branch atual.' }),
    field('history.includeCommit', 'Incluir commit', 'boolean', 'history', { default: true, description: 'Registra SHA do commit.' }),
    field('history.includeCommitMessage', 'Incluir mensagem commit', 'boolean', 'history', { default: true, description: 'Registra mensagem do commit.' }),
    field('history.includeChangedFiles', 'Incluir arquivos alterados', 'boolean', 'history', { default: true, description: 'Registra arquivos alterados.' }),

    field('reports.enabled', 'Reports habilitados', 'boolean', 'reports', { default: true, description: 'Gera evidências HTML/JSON/Markdown.' }),
    field('reports.outputDir', 'Output dir', 'text', 'reports', { default: 'dist', description: 'Pasta de saída dos reports.' }),
    field('reports.style', 'Report style', 'select', 'reports', { default: 'dark-neon', options: OPTIONS.reportStyle, description: 'Tema visual do report.' }),
    field('reports.html', 'HTML', 'boolean', 'reports', { default: true, description: 'Gera report HTML.' }),
    field('reports.json', 'JSON', 'boolean', 'reports', { default: true, description: 'Gera report JSON.' }),
    field('reports.markdown', 'Markdown', 'boolean', 'reports', { default: true, description: 'Gera report Markdown.' }),
    field('reports.includeChangeHistory', 'Incluir histórico', 'boolean', 'reports', { default: true, description: 'Mostra trilha auditável no report.' })
  ],
  presets: {
    safeDefault: {
      label: 'Safe Default',
      description: 'Recomendado para uso geral. Bloqueia perdas críticas e permite aprovações explícitas.',
      values: {
        'contractGuard.enabled': true,
        'contractGuard.baselineMode': 'stable-only',
        'contractGuard.changeDetection.detectPossibleReplacements': true,
        'contractGuard.changeDetection.similarityThreshold': 70,
        'contractGuard.changeDetection.strongSimilarityThreshold': 85,
        'contractGuard.defaultBehavior.removedEndpoint': 'block',
        'contractGuard.defaultBehavior.possibleReplacement': 'block',
        'contractGuard.defaultBehavior.changedBreakingEndpoint': 'block',
        'contractGuard.defaultBehavior.changedNonBreakingEndpoint': 'warn',
        'contractGuard.defaultBehavior.approvedBreakingChange': 'warn',
        'contractGuard.allowApprovedBreakingChanges': true
      }
    },
    strictRelease: {
      label: 'Strict Release',
      description: 'Mais rigoroso para releases sensíveis. Bloqueia quase tudo que possa quebrar contrato.',
      values: {
        'contractGuard.changeDetection.similarityThreshold': 60,
        'contractGuard.changeDetection.strongSimilarityThreshold': 80,
        'contractGuard.defaultBehavior.removedEndpoint': 'block',
        'contractGuard.defaultBehavior.possibleReplacement': 'block',
        'contractGuard.defaultBehavior.changedBreakingEndpoint': 'block',
        'contractGuard.defaultBehavior.changedNonBreakingEndpoint': 'block',
        'contractGuard.defaultBehavior.approvedBreakingChange': 'warn'
      }
    },
    advisoryMode: {
      label: 'Advisory Mode',
      description: 'Modo consultivo. Não recomendado para publicação automática no Exchange.',
      values: {
        'contractGuard.defaultBehavior.removedEndpoint': 'warn',
        'contractGuard.defaultBehavior.possibleReplacement': 'warn',
        'contractGuard.defaultBehavior.changedBreakingEndpoint': 'warn',
        'contractGuard.defaultBehavior.changedNonBreakingEndpoint': 'warn',
        'contractGuard.defaultBehavior.approvedBreakingChange': 'warn'
      }
    },
    experimentalDetection: {
      label: 'Experimental Detection',
      description: 'Aumenta a sensibilidade para encontrar possible replacements. Pode gerar falsos positivos.',
      values: {
        'contractGuard.changeDetection.detectPossibleReplacements': true,
        'contractGuard.changeDetection.similarityThreshold': 50,
        'contractGuard.changeDetection.strongSimilarityThreshold': 75
      }
    }
  }
};

function applyDefaults(config) {
  return deepMerge(DEFAULT_CONFIG, config || {});
}

function getFieldByPath(path) {
  return CONFIG_UI_SCHEMA.fields.find((field) => field.path === path);
}

module.exports = { DEFAULT_CONFIG, CONFIG_UI_SCHEMA, OPTIONS, deepMerge, applyDefaults, getFieldByPath };
