#!/usr/bin/env node
const required = ['yaml', 'raml-1-parser'];
const missing = [];

for (const dependency of required) {
  try {
    require.resolve(dependency);
    console.log(`✅ Dependência OK: ${dependency}`);
  } catch (error) {
    missing.push(dependency);
  }
}

if (missing.length) {
  console.error('❌ Dependências obrigatórias não encontradas:');
  for (const item of missing) console.error(`- ${item}`);
  console.error('\nAção sugerida: rode `npm install` ou garanta que package.json/package-lock.json foram commitados corretamente.');
  console.error('Para este projeto, o package.json precisa conter: "yaml" e "raml-1-parser" em dependencies.');
  process.exit(1);
}
