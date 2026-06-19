'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const CATALOG_FILE = path.join(ROOT, 'catalog.json');

/**
 * Minimal frontmatter parser. Supports top-level `key: value` string pairs, YAML block
 * scalars (`>`, `>-`, `|`, `|-` followed by indented lines — common for long descriptions),
 * and a single nested block (a `key:` line followed by indented `key: value` lines). This
 * is NOT a full YAML parser — it covers what skill frontmatter needs (name, description)
 * and tolerates an extra nested block a consumer may add without breaking parsing.
 *
 * @param {string} md raw SKILL.md contents
 * @returns {{ frontmatter: object, body: string }}
 */
function parseFrontmatter(md) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!match) return { frontmatter: {}, body: md.trim() };

  const [, raw, body] = match;
  const lines = raw.split(/\r?\n/);
  const frontmatter = {};
  let nestedKey = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const indented = /^\s+/.test(line);
    const kv = /^\s*([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, valueRaw] = kv;
    const value = valueRaw.trim();

    // YAML block scalar: `key: >`, `>-`, `|`, `|-` — collect the following indented lines.
    if (/^[|>][+-]?$/.test(value)) {
      const folded = value[0] === '>';
      const collected = [];
      let j = i + 1;
      while (j < lines.length && (lines[j].trim() === '' || /^\s/.test(lines[j]))) {
        collected.push(lines[j].replace(/^\s+/, ''));
        j++;
      }
      while (collected.length && collected[collected.length - 1] === '') collected.pop();
      frontmatter[key] = folded
        ? collected.join(' ').replace(/\s+/g, ' ').trim()
        : collected.join('\n');
      nestedKey = null;
      i = j - 1;
      continue;
    }

    if (indented && nestedKey) {
      frontmatter[nestedKey][key] = stripQuotes(value);
    } else if (value === '') {
      // Start of a nested block (a bare `key:` with no inline value)
      nestedKey = key;
      frontmatter[key] = {};
    } else {
      nestedKey = null;
      frontmatter[key] = stripQuotes(value);
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
 * Load and validate a skill from an arbitrary directory containing a SKILL.md.
 * The frontmatter `name` must match the directory's basename.
 * @returns {{ name, description, frontmatter, body, dir, files }} or throws on hard errors.
 */
function loadSkillFromDir(dir) {
  const folder = path.basename(dir);
  const skillFile = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    throw new Error(`skill "${folder}" has no SKILL.md`);
  }
  const { frontmatter, body } = parseFrontmatter(fs.readFileSync(skillFile, 'utf8'));
  if (!frontmatter.name || !frontmatter.description) {
    throw new Error(`skill "${folder}" SKILL.md is missing required frontmatter (name/description)`);
  }
  if (frontmatter.name !== folder) {
    throw new Error(`skill "${folder}" frontmatter name is "${frontmatter.name}" — must match folder name`);
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

/** Load and validate a single skill from skills/<name>/. */
function loadSkill(name) {
  return loadSkillFromDir(path.join(SKILLS_DIR, name));
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
    // A directory without a SKILL.md is simply not a skill (e.g. a workspace) — skip
    // it silently. Only warn when a skill is present but malformed.
    if (!fs.existsSync(path.join(SKILLS_DIR, entry.name, 'SKILL.md'))) continue;
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
  loadSkillFromDir,
  scanSkills,
  loadCatalog,
};
