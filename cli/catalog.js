'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const CATALOG_FILE = path.join(ROOT, 'catalog.json');

/**
 * Minimal frontmatter parser. Supports top-level `key: value` string pairs and a single
 * nested block (e.g. `sdlc:` followed by indented `key: value` lines). This is NOT a full
 * YAML parser — it covers exactly what skill frontmatter needs (name, description, sdlc.*).
 *
 * @param {string} md raw SKILL.md contents
 * @returns {{ frontmatter: object, body: string }}
 */
function parseFrontmatter(md) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!match) return { frontmatter: {}, body: md.trim() };

  const [, raw, body] = match;
  const frontmatter = {};
  let nestedKey = null;

  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const indented = /^\s+/.test(line);
    const kv = /^\s*([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, valueRaw] = kv;
    const value = stripQuotes(valueRaw.trim());

    if (indented && nestedKey) {
      frontmatter[nestedKey][key] = value;
    } else if (value === '') {
      // Start of a nested block, e.g. `sdlc:`
      nestedKey = key;
      frontmatter[key] = {};
    } else {
      nestedKey = null;
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body: body.trim() };
}

function stripQuotes(s) {
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

/** Recursively list files under dir, returned as paths relative to dir. */
function listFilesRecursive(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full, base));
    } else {
      out.push(path.relative(base, full));
    }
  }
  return out;
}

/**
 * Load and validate a single skill from skills/<name>/.
 * @returns {{ name, description, frontmatter, body, dir, files }} or throws on hard errors.
 */
function loadSkill(name) {
  const dir = path.join(SKILLS_DIR, name);
  const skillFile = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    throw new Error(`skill "${name}" has no SKILL.md`);
  }
  const { frontmatter, body } = parseFrontmatter(fs.readFileSync(skillFile, 'utf8'));
  if (!frontmatter.name || !frontmatter.description) {
    throw new Error(`skill "${name}" SKILL.md is missing required frontmatter (name/description)`);
  }
  if (frontmatter.name !== name) {
    throw new Error(`skill "${name}" frontmatter name is "${frontmatter.name}" — must match folder name`);
  }
  return {
    name: frontmatter.name,
    description: frontmatter.description,
    frontmatter,
    body,
    dir,
    files: listFilesRecursive(dir),
  };
}

/**
 * Scan skills/ and return valid skills. Invalid skills are skipped with a warning
 * (collected in the returned `warnings` array) rather than aborting the whole catalog.
 */
function scanSkills() {
  const skills = [];
  const warnings = [];
  if (!fs.existsSync(SKILLS_DIR)) return { skills, warnings };

  for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      skills.push(loadSkill(entry.name));
    } catch (err) {
      warnings.push(`skipped ${entry.name}: ${err.message}`);
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { skills, warnings };
}

/** Load the generated catalog.json (the runtime list the CLI reads). */
function loadCatalog() {
  if (!fs.existsSync(CATALOG_FILE)) {
    throw new Error('catalog.json not found — run `npm run build` first');
  }
  return JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
}

module.exports = {
  ROOT,
  SKILLS_DIR,
  CATALOG_FILE,
  parseFrontmatter,
  listFilesRecursive,
  loadSkill,
  scanSkills,
  loadCatalog,
};
