#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const YAML = require('yaml');

const configPath = process.env.GUARDIAN_CONFIG || 'release/guardian.config.yml';
function readConfig() {
  if (!fs.existsSync(configPath)) return {};
  return YAML.parse(fs.readFileSync(configPath, 'utf8')) || {};
}

const config = readConfig();
const appName = process.env.APP_NAME || config.project?.name || 'raml-api';
const mainFile = process.env.API_MAIN_FILE || config.project?.mainFile || config.exchange?.mainFile || 'api.raml';
const assetId = process.env.EXCHANGE_ASSET_ID || config.exchange?.assetId || appName;
const distDir = process.env.DIST_DIR || config.reports?.outputDir || 'dist';
const outputZip = process.env.EXCHANGE_ZIP || path.join(distDir, `${assetId}-exchange.zip`);

const includeCandidates = [
  mainFile,
  'README.md',
  'types',
  'examples',
  'traits',
  'securitySchemes',
  'resourceTypes',
  'docs',
  'release',
  'config/exchange.asset.json'
  // IMPORTANTE: não incluir exchange.json raiz no raml.zip.
  // O Exchange CLI valida esse descriptor contra os metadados passados no publish.
  // Como a versão é resolvida por auto bump no momento da publicação, um exchange.json
  // com placeholders quebra com 400: mismatch groupId/version/apiVersion/organizationId.
];

const required = [mainFile, 'release/release-manifest.yml'];
for (const item of required) {
  if (!fs.existsSync(item)) {
    console.error(`❌ Item obrigatório não encontrado: ${item}`);
    process.exit(1);
  }
}

fs.mkdirSync(distDir, { recursive: true });
if (fs.existsSync(outputZip)) fs.rmSync(outputZip, { force: true });

console.log('================================================================================');
console.log('📦 Gerando pacote Exchange');
console.log('================================================================================');
console.log(`Saída: ${outputZip}`);

if (fs.existsSync('exchange.json')) {
  console.log('⚠️  exchange.json encontrado na raiz do projeto, mas NÃO será incluído no raml.zip.');
  console.log('   Motivo: evita erro 400 de mismatch no Anypoint Exchange quando a versão é resolvida por auto bump.');
}

const output = fs.createWriteStream(outputZip);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  const sizeMb = (archive.pointer() / 1024 / 1024).toFixed(2);
  console.log(`✅ Pacote gerado com sucesso: ${outputZip} (${sizeMb} MB)`);
});

archive.on('warning', (err) => console.warn(`⚠️ ${err.message}`));
archive.on('error', (err) => {
  console.error(`❌ Falha ao gerar ZIP: ${err.message}`);
  process.exit(1);
});

archive.pipe(output);

function addPath(item) {
  if (!fs.existsSync(item)) return;
  const stat = fs.statSync(item);
  if (stat.isDirectory()) {
    archive.directory(item, item, (entry) => {
      if (!entry || !entry.name) return entry;
      if (entry.name.includes('node_modules/') || entry.name.includes('.git/') || entry.name.startsWith('dist/')) return false;
      if (entry.name.startsWith('.github/') || entry.name.startsWith('.azuredevops/') || entry.name.startsWith('.maven/') || entry.name.startsWith('scripts/') || entry.name.startsWith('tools/')) return false;
      return entry;
    });
  } else {
    archive.file(item, { name: item });
  }
}

for (const item of includeCandidates) addPath(item);
archive.finalize();
