// The JSON Schema subset the files in schemas/ use.
import { readFileSync } from 'node:fs';

const typeOf = (value) => (Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value);

export function validate(value, schema, path = '$') {
  const errors = [];
  if (schema.type && typeOf(value) !== schema.type) {
    return [`${path}: expected ${schema.type}, got ${typeOf(value)}`];
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  }
  if (schema.type === 'object') {
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) errors.push(`${path}.${key}: required`);
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (value[key] !== undefined) errors.push(...validate(value[key], sub, `${path}.${key}`));
    }
  }
  if (schema.type === 'array') {
    if (schema.minItems && value.length < schema.minItems) {
      errors.push(`${path}: needs at least ${schema.minItems} item(s)`);
    }
    if (schema.items) value.forEach((item, i) => errors.push(...validate(item, schema.items, `${path}[${i}]`)));
  }
  return errors;
}

export function loadSchema(name) {
  return JSON.parse(readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), 'utf8'));
}
