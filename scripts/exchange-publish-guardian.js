#!/usr/bin/env node

/**
 * Release Flow Guardian — Exchange Publish with Auto Bump
 *
 * Objetivo:
 * - Validar preflight do pacote Exchange
 * - Consultar Exchange para descobrir última versão 1.0.x
 * - Publicar como 1.0.0 se asset não existir
 * - Se existir, publicar latest patch + 1
 * - Se der 409, reconsultar e fazer auto bump até 3 vezes
 * - Se der 400, falhar com diagnóstico, exceto quando a mensagem indicar versão duplicada
 * - Gerar relatório Markdown/JSON em dist/
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const REPORT_DIR = process.env.DIST_DIR || "dist";
const REPORT_MD = path.join(REPORT_DIR, "exchange-publish-report.md");
const REPORT_JSON = path.join(REPORT_DIR, "exchange-publish-report.json");

const config = {
  appName: process.env.APP_NAME || "mule-tlf-com-test",
  host: process.env.ANYPOINT_HOST || "anypoint.mulesoft.com",
  clientId: process.env.ANYPOINT_CLIENT_ID || "",
  clientSecret: process.env.ANYPOINT_CLIENT_SECRET || "",
  orgId: process.env.ANYPOINT_ORG || "",
  groupId: process.env.EXCHANGE_GROUP_ID || process.env.ANYPOINT_ORG || "",
  assetId: process.env.EXCHANGE_ASSET_ID || "mule-tlf-com-test",
  assetName: process.env.EXCHANGE_ASSET_NAME || "Mule TLF COM Test",
  assetDescription:
    process.env.EXCHANGE_ASSET_DESCRIPTION ||
    "API RAML de laboratório para Release Flow Guardian.",
  apiVersion: process.env.API_VERSION || "v1",
  mainFile: process.env.API_MAIN_FILE || "api.raml",
  zipPath: process.env.EXCHANGE_ZIP || "dist/mule-tlf-com-test-exchange.zip",
  status: process.env.EXCHANGE_STATUS || "published",
  type: process.env.EXCHANGE_ASSET_TYPE || "rest-api",
  keywords:
    process.env.EXCHANGE_KEYWORDS ||
    "mulesoft,raml,release-flow-guardian,api-led,design-center",
  minorVersion: process.env.EXCHANGE_MINOR_VERSION || "1.0",
  initialVersion: process.env.EXCHANGE_INITIAL_VERSION || "1.0.0",
  maxConflictBumps: Number(process.env.EXCHANGE_MAX_CONFLICT_BUMPS || "3"),
  maxTransientRetries: Number(process.env.EXCHANGE_MAX_TRANSIENT_RETRIES || "3"),
  contactName: process.env.CONTACT_NAME || "Release Flow Guardian",
  contactEmail: process.env.CONTACT_EMAIL || "leonel.d.porto@accenture.com",
};

const report = {
  assetId: config.assetId,
  groupId: config.groupId,
  minorLine: config.minorVersion,
  mainFile: config.mainFile,
  zipPath: config.zipPath,
  resolvedVersion: null,
  latestVersionFound: null,
  status: "RUNNING",
  startedAt: new Date().toISOString(),
  finishedAt: null,
  checks: [],
  publish: [],
  versions: [],
  errors: [],
  warnings: [],
};

function addCheck(status, message, details = undefined) {
  report.checks.push({ status, message, details });
  const icon = status === "OK" ? "✅" : status === "WARN" ? "⚠️" : "❌";
  console.log(`${icon} ${message}${details ? ` | ${details}` : ""}`);
}

function addPublish(status, message, details = undefined) {
  report.publish.push({ status, message, details });
  const icon = status === "OK" ? "✅" : status === "WARN" ? "⚠️" : status === "INFO" ? "ℹ️" : "❌";
  console.log(`${icon} ${message}${details ? ` | ${details}` : ""}`);
}

function fail(message, details = undefined) {
  report.status = "BLOCKED";
  report.errors.push({ message, details });
  addPublish("BLOCK", message, details);
  writeReport();
  process.exit(1);
}

function warn(message, details = undefined) {
  report.warnings.push({ message, details });
  addPublish("WARN", message, details);
}

function requireEnv(name, value) {
  if (!value) {
    addCheck("BLOCK", `Variável obrigatória ausente: ${name}`);
    return false;
  }
  addCheck("OK", `${name} configurada`);
  return true;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    timeout: options.timeout || 20 * 60 * 1000,
    shell: false,
    env: process.env,
  });

  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    output: `${result.stdout || ""}\n${result.stderr || ""}`.trim(),
  };
}

function classifyError(text, fallbackStatus = undefined) {
  const raw = String(text || "");
  const lower = raw.toLowerCase();

  const statusMatch =
    raw.match(/status code\s*[:=]?\s*(\d{3})/i) ||
    raw.match(/\bhttp\s*(\d{3})\b/i) ||
    raw.match(/\b(\d{3})\b/);

  const code = fallbackStatus || (statusMatch ? Number(statusMatch[1]) : undefined);

  if (code === 409 || lower.includes("conflict")) return { code: 409, type: "CONFLICT" };

  if (
    code === 400 ||
    lower.includes("bad request") ||
    lower.includes("request failed with status code 400")
  ) {
    if (
      lower.includes("already exists") ||
      lower.includes("version already exists") ||
      lower.includes("asset version exists") ||
      lower.includes("duplicate version") ||
      lower.includes("duplicated version")
    ) {
      return { code: 400, type: "BAD_REQUEST_DUPLICATE_VERSION" };
    }

    return { code: 400, type: "BAD_REQUEST" };
  }

  if (code === 401 || lower.includes("unauthorized")) return { code: 401, type: "UNAUTHORIZED" };
  if (code === 403 || lower.includes("forbidden")) return { code: 403, type: "FORBIDDEN" };
  if (code === 404 || lower.includes("not found")) return { code: 404, type: "NOT_FOUND" };
  if (code === 412 || lower.includes("precondition")) return { code: 412, type: "PRECONDITION_FAILED" };
  if (code === 429 || lower.includes("rate limit") || lower.includes("too many requests")) {
    return { code: 429, type: "RATE_LIMIT" };
  }
  if ([500, 502, 503, 504].includes(code) || lower.includes("timeout") || lower.includes("network")) {
    return { code, type: "TRANSIENT" };
  }

  return { code, type: "UNKNOWN" };
}

async function getAccessToken() {
  const url = `https://${config.host}/accounts/api/v2/oauth2/token`;
  const body = {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "client_credentials",
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!response.ok) {
    const classified = classifyError(text, response.status);

    if (classified.code === 401) {
      fail("Credencial inválida ao autenticar na Anypoint", "Revise ANYPOINT_CONNECTED_APP_CLIENT_ID e ANYPOINT_CONNECTED_APP_CLIENT_SECRET.");
    }

    if (classified.code === 403) {
      fail("Connected App sem permissão para autenticar/consultar Anypoint", "Revise scopes/roles e Business Group.");
    }

    fail(`Falha ao obter token Anypoint. HTTP ${response.status}`, text);
  }

  if (!json.access_token) {
    fail("Token Anypoint não retornado", text);
  }

  addCheck("OK", "Autenticação Anypoint via Connected App");
  return json.access_token;
}

function configureAnypointCli() {
  addCheck("OK", "Configurando Anypoint CLI v4");

  const commands = [
    ["conf", "client_id", config.clientId],
    ["conf", "client_secret", config.clientSecret],
    ["conf", "organization", config.orgId],
    ["conf", "host", config.host],
  ];

  for (const args of commands) {
    const result = runCommand("anypoint-cli-v4", args, { timeout: 60_000 });
    if (result.status !== 0) {
      fail("Falha ao configurar Anypoint CLI v4", result.output);
    }
  }
}

function validateZipContainsMainFile() {
  if (!fs.existsSync(config.zipPath)) {
    fail("Pacote Exchange não encontrado", `Execute antes: npm run package:exchange | Path: ${config.zipPath}`);
  }

  addCheck("OK", "ZIP do Exchange encontrado", config.zipPath);

  const result = runCommand("unzip", ["-l", config.zipPath], { timeout: 60_000 });

  if (result.status !== 0) {
    fail("Não foi possível inspecionar o ZIP do Exchange", result.output);
  }

  const entries = result.stdout;
  const hasMainFile = entries.split(/\r?\n/).some((line) => {
    const clean = line.trim();
    return clean.endsWith(` ${config.mainFile}`) || clean.endsWith(config.mainFile);
  });

  if (!hasMainFile) {
    fail("mainFile não encontrado dentro do ZIP", `Esperado: ${config.mainFile}`);
  }

  addCheck("OK", `${config.mainFile} encontrado dentro do ZIP`);
}

async function listVersionsViaGraphQL(token) {
  const url = `https://${config.host}/graph/api/v1/graphql`;
  const versions = [];
  const limit = 100;
  let offset = 0;
  let safety = 0;

  // A documentação do Exchange mostra o uso do endpoint GraphQL para listar assets com groupId, assetId e version.
  // Aqui paginamos para evitar depender de apenas uma página.
  while (safety < 20) {
    safety += 1;

    const query = `query ReleaseFlowGuardianAssets {
      assets(query: { rootOrganizationId: "${config.orgId}", limit: ${limit}, offset: ${offset} }) {
        groupId
        assetId
        version
      }
    }`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query }),
    });

    const text = await response.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }

    if (!response.ok || json.errors) {
      const details = json.errors ? JSON.stringify(json.errors) : text;
      throw new Error(`GraphQL Exchange query failed: ${details}`);
    }

    const page = json?.data?.assets || [];

    for (const asset of page) {
      if (asset.groupId === config.groupId && asset.assetId === config.assetId && asset.version) {
        versions.push(asset.version);
      }
    }

    if (page.length < limit) break;
    offset += limit;
  }

  return [...new Set(versions)];
}

function listVersionsViaCli() {
  const candidates = [
    ["exchange:asset:list", "--output", "json"],
    ["exchange", "asset", "list", "--output", "json"],
  ];

  for (const args of candidates) {
    const result = runCommand("anypoint-cli-v4", args, { timeout: 120_000 });

    if (result.status !== 0 || !result.stdout.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(result.stdout);
      const records = Array.isArray(parsed) ? parsed : parsed.data || parsed.assets || parsed.items || [];

      const versions = [];
      for (const item of records) {
        const groupId = item.groupId || item.group || item.organizationId;
        const assetId = item.assetId || item.id || item.name;
        const version = item.version || item.assetVersion;

        if (groupId === config.groupId && assetId === config.assetId && version) {
          versions.push(version);
        }

        // Alguns outputs retornam assetIdentifier em formato group/asset/version.
        const assetIdentifier = item.assetIdentifier || item.identifier || "";
        const parts = String(assetIdentifier).split("/");
        if (parts.length >= 3 && parts[0] === config.groupId && parts[1] === config.assetId) {
          versions.push(parts[2]);
        }
      }

      return [...new Set(versions)];
    } catch {
      // Continua para o próximo formato/fallback.
    }
  }

  return [];
}

async function getExchangeVersions(token) {
  let versions = [];

  try {
    versions = await listVersionsViaGraphQL(token);
    if (versions.length) {
      addCheck("OK", "Versões existentes encontradas via Exchange GraphQL", versions.join(", "));
      report.versions = versions;
      return versions;
    }

    addCheck("WARN", "Nenhuma versão encontrada via GraphQL", "Pode ser asset novo ou limitação da consulta.");
  } catch (error) {
    warn("Não foi possível consultar versões via GraphQL", String(error.message || error));
  }

  versions = listVersionsViaCli();

  if (versions.length) {
    addCheck("OK", "Versões existentes encontradas via Anypoint CLI", versions.join(", "));
    report.versions = versions;
    return versions;
  }

  addCheck("WARN", "Nenhuma versão encontrada no Exchange", "Será tratado como asset novo.");
  report.versions = [];
  return [];
}

function parsePatch(version) {
  const escapedMinor = config.minorVersion.replace(".", "\\.");
  const regex = new RegExp(`^${escapedMinor}\\.(\\d+)$`);
  const match = String(version).match(regex);

  if (!match) return null;
  return Number(match[1]);
}

function resolveNextVersion(versions) {
  const patches = versions
    .map(parsePatch)
    .filter((value) => Number.isInteger(value) && value >= 0);

  if (!patches.length) {
    report.latestVersionFound = null;
    report.resolvedVersion = config.initialVersion;
    addCheck("OK", "Asset novo ou sem versões na minor line", `Próxima versão: ${config.initialVersion}`);
    return config.initialVersion;
  }

  const latestPatch = Math.max(...patches);
  const latestVersion = `${config.minorVersion}.${latestPatch}`;
  const nextVersion = `${config.minorVersion}.${latestPatch + 1}`;

  report.latestVersionFound = latestVersion;
  report.resolvedVersion = nextVersion;

  addCheck("OK", "Última versão Exchange localizada", latestVersion);
  addCheck("OK", "Próxima versão calculada", nextVersion);

  return nextVersion;
}

function buildUploadArgs(version) {
  const assetIdentifier = `${config.groupId}/${config.assetId}/${version}`;

  const propertiesJson = JSON.stringify({
    apiVersion: config.apiVersion,
    mainFile: config.mainFile,
    contactName: config.contactName,
    contactEmail: config.contactEmail,
  });

  const filesJson = JSON.stringify({
    "raml.zip": config.zipPath,
  });

  return {
    assetIdentifier,
    args: [
      "exchange:asset:upload",
      assetIdentifier,
      "--name",
      config.assetName,
      "--description",
      config.assetDescription,
      "--type",
      config.type,
      "--properties",
      propertiesJson,
      "--files",
      filesJson,
      "--status",
      config.status,
      "--keywords",
      config.keywords,
    ],
  };
}

function publishVersion(version) {
  const { assetIdentifier, args } = buildUploadArgs(version);

  addPublish("INFO", "Tentando publicar no Exchange", assetIdentifier);

  const result = runCommand("anypoint-cli-v4", args, { timeout: 25 * 60 * 1000 });

  if (result.status === 0) {
    addPublish("OK", "Publicação aceita/concluída pelo Exchange", version);
    return { ok: true, result };
  }

  const classified = classifyError(result.output);

  return {
    ok: false,
    result,
    classified,
  };
}

async function verifyVersionExists(token, version) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const versions = await getExchangeVersions(token);
    if (versions.includes(version)) {
      addPublish("OK", "Versão confirmada no Exchange", version);
      return true;
    }

    addPublish("INFO", `Aguardando versão aparecer no Exchange (${attempt}/6)`, version);
    await sleep(5000);
  }

  warn("Não foi possível confirmar a versão no Exchange após a publicação", version);
  return false;
}

async function publishWithAutoBump(token, initialVersion) {
  let version = initialVersion;
  let conflictBumps = 0;
  let transientRetries = 0;

  while (true) {
    report.resolvedVersion = version;

    const publish = publishVersion(version);

    if (publish.ok) {
      await verifyVersionExists(token, version);
      report.status = "PUBLISHED";
      return version;
    }

    const { classified, result } = publish;
    const output = result.output;

    if (classified.type === "CONFLICT" || classified.type === "BAD_REQUEST_DUPLICATE_VERSION") {
      conflictBumps += 1;

      addPublish("WARN", `Conflito de versão detectado (${conflictBumps}/${config.maxConflictBumps})`, version);

      if (conflictBumps > config.maxConflictBumps) {
        fail(
          "Não foi possível publicar após 3 tentativas de auto bump",
          "Provável concorrência de pipelines ou publicação manual simultânea."
        );
      }

      const versions = await getExchangeVersions(token);
      version = resolveNextVersion(versions);
      addPublish("INFO", "Nova versão calculada após conflito", version);
      continue;
    }

    if (classified.type === "BAD_REQUEST") {
      fail(
        "Exchange retornou 400 Bad Request",
        [
          "Motivo provável:",
          "- ZIP inválido",
          "- mainFile não encontrado",
          "- classifier/type inválido",
          "- metadata/properties inválido",
          "- assetId/version/groupId fora do padrão",
          "",
          "Saída da CLI:",
          output,
        ].join("\n")
      );
    }

    if (classified.type === "UNAUTHORIZED") {
      fail("Credencial inválida", "Revise ANYPOINT_CONNECTED_APP_CLIENT_ID e ANYPOINT_CONNECTED_APP_CLIENT_SECRET.");
    }

    if (classified.type === "FORBIDDEN") {
      fail(
        "Connected App sem permissão",
        "Revise scopes/roles. Para publicação no Exchange, use permissão equivalente a Exchange Contributor/Admin no Business Group."
      );
    }

    if (classified.type === "NOT_FOUND") {
      fail("Endpoint/Org/Group/Asset não encontrado no publish", output);
    }

    if (classified.type === "PRECONDITION_FAILED") {
      const versions = await getExchangeVersions(token);
      if (versions.includes(version)) {
        warn("Exchange retornou 412, mas a versão apareceu publicada", version);
        report.status = "PUBLISHED_WITH_WARNING";
        return version;
      }

      fail("Exchange retornou 412 Precondition Failed", output);
    }

    if (classified.type === "RATE_LIMIT" || classified.type === "TRANSIENT" || classified.type === "UNKNOWN") {
      transientRetries += 1;

      const versions = await getExchangeVersions(token);
      if (versions.includes(version)) {
        warn("Erro transitório retornado, mas a versão apareceu publicada", version);
        report.status = "PUBLISHED_WITH_WARNING";
        return version;
      }

      if (transientRetries > config.maxTransientRetries) {
        fail("Falha transitória persistente ao publicar no Exchange", output);
      }

      const waitSeconds = Math.min(60, 10 * transientRetries);
      addPublish("WARN", `Erro transitório/rate limit. Retry ${transientRetries}/${config.maxTransientRetries}`, `Aguardando ${waitSeconds}s`);
      await sleep(waitSeconds * 1000);
      continue;
    }

    fail("Falha não classificada ao publicar no Exchange", output);
  }
}

function writeReport() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  report.finishedAt = new Date().toISOString();

  const md = [
    "# Release Flow Guardian — Exchange Publish Report",
    "",
    `- **Asset ID:** ${report.assetId}`,
    `- **Group ID:** ${report.groupId}`,
    `- **Minor Line:** ${report.minorLine}`,
    `- **Resolved Version:** ${report.resolvedVersion || "N/A"}`,
    `- **Latest Version Found:** ${report.latestVersionFound || "N/A"}`,
    `- **Main File:** ${report.mainFile}`,
    `- **Package:** ${report.zipPath}`,
    `- **Status:** ${report.status}`,
    "",
    "## Preflight",
    "",
    ...report.checks.map((item) => `- [${item.status}] ${item.message}${item.details ? ` — ${item.details}` : ""}`),
    "",
    "## Publish",
    "",
    ...(report.publish.length
      ? report.publish.map((item) => `- [${item.status}] ${item.message}${item.details ? ` — ${String(item.details).replace(/\n/g, " | ")}` : ""}`)
      : ["- Nenhuma etapa de publicação registrada."]),
    "",
    "## Versions",
    "",
    ...(report.versions.length ? report.versions.map((version) => `- ${version}`) : ["- Nenhuma versão encontrada antes da publicação."]),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item.message}${item.details ? ` — ${item.details}` : ""}`) : ["- Nenhum warning."]),
    "",
    "## Errors",
    "",
    ...(report.errors.length ? report.errors.map((item) => `- ${item.message}${item.details ? ` — ${String(item.details).replace(/\n/g, " | ")}` : ""}`) : ["- Nenhum erro."]),
    "",
  ].join("\n");

  fs.writeFileSync(REPORT_MD, md, "utf-8");
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf-8");

  console.log(`📄 Relatório Markdown: ${REPORT_MD}`);
  console.log(`📄 Relatório JSON: ${REPORT_JSON}`);
}

async function main() {
  console.log("================================================================================");
  console.log("🚀 Release Flow Guardian — Exchange Publish with Auto Bump");
  console.log("================================================================================");

  const envOk = [
    requireEnv("ANYPOINT_CLIENT_ID", config.clientId),
    requireEnv("ANYPOINT_CLIENT_SECRET", config.clientSecret),
    requireEnv("ANYPOINT_ORG", config.orgId),
    requireEnv("ANYPOINT_HOST", config.host),
    requireEnv("EXCHANGE_GROUP_ID", config.groupId),
  ].every(Boolean);

  if (!envOk) {
    fail("Variáveis obrigatórias ausentes", "Configure os secrets/variables da pipeline.");
  }

  validateZipContainsMainFile();
  configureAnypointCli();

  const token = await getAccessToken();
  const versions = await getExchangeVersions(token);
  const nextVersion = resolveNextVersion(versions);
  const publishedVersion = await publishWithAutoBump(token, nextVersion);

  report.resolvedVersion = publishedVersion;
  if (report.status === "RUNNING") {
    report.status = "PUBLISHED";
  }

  writeReport();

  console.log("================================================================================");
  console.log(`✅ Publicação finalizada. Versão: ${publishedVersion}`);
  console.log("================================================================================");
}

main().catch((error) => {
  report.status = "BLOCKED";
  report.errors.push({
    message: "Erro inesperado no Exchange Publish Guardian",
    details: String(error.stack || error.message || error),
  });
  writeReport();
  console.error(error);
  process.exit(1);
});
