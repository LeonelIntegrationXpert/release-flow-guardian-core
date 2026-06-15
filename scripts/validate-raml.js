#!/usr/bin/env node
const raml = require('raml-1-parser');
const fs = require('fs');

const file = process.argv[2] || 'api.raml';

async function main() {
  console.log('================================================================================');
  console.log('RAML VALIDATION');
  console.log('================================================================================');
  console.log(`Arquivo: ${file}`);

  if (!fs.existsSync(file)) {
    console.error(`❌ RAML principal não encontrado: ${file}`);
    process.exit(1);
  }

  const api = await raml.loadApi(file, { rejectOnErrors: false });
  const errors = api.errors();

  if (errors && errors.length > 0) {
    console.error('\n❌ RAML inválido. Erros encontrados:\n');

    errors.forEach((error, index) => {
      const range = error.range || {};
      const start = range.start || {};
      console.error(`#${index + 1}`);
      console.error(`Mensagem: ${error.message}`);
      console.error(`Arquivo:   ${error.path || file}`);
      console.error(`Linha:     ${start.line ?? 'N/A'}`);
      console.error(`Coluna:    ${start.column ?? 'N/A'}`);
      console.error('-'.repeat(80));
    });

    process.exit(1);
  }

  const title = api.title && api.title();
  const version = api.version && api.version();
  const resources = api.resources ? api.resources() : [];

  console.log('✅ RAML válido');
  console.log(`Título: ${title}`);
  console.log(`Versão: ${version}`);
  console.log(`Recursos raiz: ${resources.length}`);
}

main().catch(error => {
  console.error('❌ Falha inesperada ao validar RAML:');
  console.error(error);
  process.exit(1);
});
