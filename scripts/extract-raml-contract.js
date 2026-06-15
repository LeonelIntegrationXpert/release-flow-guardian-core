#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const raml = require('raml-1-parser');

const inputFile = process.argv[2] || 'api.raml';
const outputFile = process.argv[3] || 'dist/api-contract-current.json';

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeType(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).sort();
  return [String(value)];
}

function getNamedMap(raw) {
  const result = {};
  if (!raw) return result;

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item) continue;
      const name = item.name || item.displayName || item.key;
      if (name) result[name] = item;
    }
    return result;
  }

  if (typeof raw === 'object') {
    for (const [name, value] of Object.entries(raw)) {
      result[name] = value || {};
    }
  }

  return result;
}

function normalizeParameters(raw) {
  const params = getNamedMap(raw);
  const result = {};

  for (const [name, param] of Object.entries(params)) {
    result[name] = {
      name,
      required: Boolean(param.required),
      type: normalizeType(param.type),
      enum: asArray(param.enum).map(String).sort(),
      pattern: param.pattern || null,
      default: param.default ?? null,
      description: param.description || ''
    };
  }

  return result;
}

function normalizeBodies(raw) {
  const bodies = getNamedMap(raw);
  const result = {};

  for (const [mediaType, body] of Object.entries(bodies)) {
    result[mediaType] = {
      mediaType,
      type: normalizeType(body.type),
      required: Boolean(body.required)
    };
  }

  return result;
}

function normalizeResponses(raw) {
  const responses = getNamedMap(raw);
  const result = {};

  for (const [code, response] of Object.entries(responses)) {
    result[String(code)] = {
      code: String(code),
      description: response.description || '',
      body: normalizeBodies(response.body)
    };
  }

  return result;
}

function normalizeMethod(methodJson, fullPath) {
  const method = String(methodJson.method || '').toUpperCase();
  const id = `${method} ${fullPath}`;

  return {
    id,
    method,
    path: fullPath,
    displayName: methodJson.displayName || '',
    description: methodJson.description || '',
    queryParameters: normalizeParameters(methodJson.queryParameters),
    body: normalizeBodies(methodJson.body),
    responses: normalizeResponses(methodJson.responses),
    securedBy: asArray(methodJson.securedBy).map(String).filter(Boolean).sort(),
    traits: asArray(methodJson.is).map(String).filter(Boolean).sort(),
    protocols: asArray(methodJson.protocols).map(String).filter(Boolean).sort()
  };
}

function normalizeTypeProperties(typeName, typeDefinition, prefix = '') {
  const properties = {};
  const rawProperties = getNamedMap(typeDefinition.properties);

  for (const [propertyName, property] of Object.entries(rawProperties)) {
    const propertyPath = prefix ? `${prefix}.${propertyName}` : propertyName;

    properties[propertyPath] = {
      name: propertyName,
      path: propertyPath,
      required: Boolean(property.required),
      type: normalizeType(property.type),
      enum: asArray(property.enum).map(String).sort()
    };

    if (property.properties) {
      Object.assign(properties, normalizeTypeProperties(typeName, property, propertyPath));
    }
  }

  return properties;
}

function normalizeTypes(apiJson) {
  const result = {};
  const typeArray = apiJson.types || [];

  for (const entry of typeArray) {
    for (const [typeName, typeDefinition] of Object.entries(entry || {})) {
      result[typeName] = {
        name: typeName,
        type: normalizeType(typeDefinition.type),
        properties: normalizeTypeProperties(typeName, typeDefinition)
      };
    }
  }

  return result;
}

function normalizeSecuritySchemes(apiJson) {
  const schemes = apiJson.securitySchemes || [];
  const result = [];

  for (const entry of schemes) {
    for (const name of Object.keys(entry || {})) {
      result.push(name);
    }
  }

  return [...new Set(result)].sort();
}

function normalizeTraits(apiJson) {
  const traits = apiJson.traits || [];
  const result = [];

  for (const entry of traits) {
    for (const name of Object.keys(entry || {})) {
      result.push(name);
    }
  }

  return [...new Set(result)].sort();
}

async function extractContract(file) {
  const api = await raml.loadApi(file, { rejectOnErrors: false });
  const errors = api.errors();

  if (errors && errors.length) {
    const details = errors.map((error) => `${error.message} (${error.path || file})`).join('\n');
    throw new Error(`RAML inválido. Corrija antes de extrair contrato.\n${details}`);
  }

  const apiJson = api.toJSON({ serializeMetadata: false });
  const endpoints = [];

  function walkResources(resources) {
    for (const resource of resources || []) {
      const fullPath = String(resource.completeRelativeUri());
      const resourceJson = resource.toJSON({ serializeMetadata: false });
      const uriParameters = normalizeParameters(resourceJson.uriParameters);

      for (const method of resource.methods ? resource.methods() : []) {
        const methodJson = method.toJSON({ serializeMetadata: false });
        const endpoint = normalizeMethod(methodJson, fullPath);
        endpoint.uriParameters = uriParameters;
        endpoints.push(endpoint);
      }

      if (resource.resources) {
        walkResources(resource.resources());
      }
    }
  }

  walkResources(api.resources ? api.resources() : []);

  endpoints.sort((a, b) => a.id.localeCompare(b.id));

  return {
    contractVersion: '1.0',
    sourceFile: file,
    generatedAt: new Date().toISOString(),
    title: apiJson.title || null,
    version: apiJson.version || null,
    baseUri: apiJson.baseUri || null,
    protocols: asArray(apiJson.protocols).map(String).sort(),
    securitySchemes: normalizeSecuritySchemes(apiJson),
    traits: normalizeTraits(apiJson),
    endpoints,
    types: normalizeTypes(apiJson)
  };
}

async function main() {
  console.log('================================================================================');
  console.log('API CONTRACT EXTRACTOR');
  console.log('================================================================================');
  console.log(`Input:  ${inputFile}`);
  console.log(`Output: ${outputFile}`);

  if (!fs.existsSync(inputFile)) {
    console.error(`❌ Arquivo RAML não encontrado: ${inputFile}`);
    process.exit(1);
  }

  const contract = await extractContract(inputFile);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(contract, null, 2), 'utf-8');

  console.log(`✅ Contrato extraído com sucesso.`);
  console.log(`Endpoints: ${contract.endpoints.length}`);
  console.log(`Types:     ${Object.keys(contract.types).length}`);
}

main().catch((error) => {
  console.error('❌ Falha ao extrair contrato RAML:');
  console.error(error.stack || error.message || error);
  process.exit(1);
});
