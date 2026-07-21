'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const CATALOG_FILE = path.join(ROOT, 'catalog.json');

/**
 * Skills live in bucket folders: skills/<bucket>/<name>/. The bucket a skill sits in is
 * the ONLY thing that decides whether it ships — there is no separate status field to
 * keep in sync. Promoted buckets are published (catalog.json, the Claude plugin, the
 * README); everything else stays in the repo so work-in-progress and retired skills can
 * be committed without ever reaching a user.
 *
 * Adding a topical bucket = add it to PROMOTED_BUCKETS and create the folder. Nothing
 * else in the codebase enumerates buckets.
 */
const PROMOTED_BUCKETS = ['engineering', 'ops', 'productivity'];
const UNPROMOTED_BUCKETS = ['in-progress', 'deprecated'];
const BUCKETS = [...PROMOTED_BUCKETS, ...UNPROMOTED_BUCKETS];

/**
 * Who can reach a skill. One decision for every platform, deliberately not per-platform:
 * a skill is user-invoked everywhere or nowhere, and each adapter expresses that in its
 * own dialect.
 *
 * - `model` (default) — the agent can fire it autonomously, so its `description` is
 *   loaded into context every turn and is written for the model (rich trigger phrasing).
 * - `user` — only the human, typing its name, can reach it. Zero context load, and the
 *   `description` becomes a human-facing one-liner with the trigger list stripped.
 */
const INVOCATIONS = ['model', 'user'];

/**
 * Platform ids a skill may carry an override for, matching each adapter's `id`. The only
 * supported value is `skip` — "this platform cannot express what the skill needs, so do
 * not install it here".
 */
const PLATFORMS = ['claude', 'codex', 'copilot'];
const PLATFORM_VALUES = ['skip'];

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
      // A bare `key:` while already one level deep would be a second level. This parser
      // holds exactly one, and used to flatten the deeper keys into the level above it
      // without complaint — a corrupted skill that still built and still passed tests.
      // Fail loudly instead; the caller skips the skill and prints why.
      if (value === '') {
        throw new Error(
          `frontmatter key "${nestedKey}.${key}" nests too deep — this parser supports one level of nesting, so keep values flat (e.g. "${key}: skip")`
        );
      }
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
 * `bucket` is the folder under skills/ the skill was found in (null for a standalone dir,
 * e.g. a test fixture); when set it also yields `path`, the repo-relative posix path that
 * catalog.json and the plugin manifest publish.
 * @returns {{ name, description, frontmatter, body, dir, files, bucket, path }} or throws.
 */
function loadSkillFromDir(dir, bucket = null) {
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

  const invocation = frontmatter.invocation || 'model';
  if (!INVOCATIONS.includes(invocation)) {
    throw new Error(
      `skill "${folder}" has invocation "${invocation}" — must be one of: ${INVOCATIONS.join(', ')}`
    );
  }

  const platforms = frontmatter.platforms || {};
  if (typeof platforms !== 'object' || Array.isArray(platforms)) {
    throw new Error(`skill "${folder}" frontmatter "platforms" must be a block of key: value pairs`);
  }
  for (const [id, value] of Object.entries(platforms)) {
    if (!PLATFORMS.includes(id)) {
      throw new Error(
        `skill "${folder}" has an override for unknown platform "${id}" — known: ${PLATFORMS.join(', ')}`
      );
    }
    if (!PLATFORM_VALUES.includes(value)) {
      throw new Error(
        `skill "${folder}" sets platforms.${id} to "${value}" — the only supported value is: ${PLATFORM_VALUES.join(', ')}`
      );
    }
  }

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    frontmatter,
    body,
    dir,
    files: listFilesRecursive(dir),
    bucket,
    invocation,
    platforms,
    path: bucket ? path.posix.join('skills', bucket, folder) : null,
  };
}

/** Load and validate a single skill by name, searching every bucket. */
function loadSkill(name) {
  for (const bucket of BUCKETS) {
    const dir = path.join(SKILLS_DIR, bucket, name);
    if (fs.existsSync(path.join(dir, 'SKILL.md'))) return loadSkillFromDir(dir, bucket);
  }
  throw new Error(`skill "${name}" not found in any bucket (${BUCKETS.join(', ')})`);
}

/**
 * Scan skills/<bucket>/<name>/ and return valid skills. Invalid skills are skipped with a
 * warning (collected in the returned `warnings` array) rather than aborting the whole
 * catalog. By default only PROMOTED buckets are returned — that default is what keeps
 * in-progress and deprecated work out of everything we publish.
 *
 * @param {{ buckets?: string[] }} [opts] buckets to scan; defaults to the promoted ones.
 */
function scanSkills({ buckets = PROMOTED_BUCKETS } = {}) {
  const skills = [];
  const warnings = [];
  if (!fs.existsSync(SKILLS_DIR)) return { skills, warnings };

  // Guard the migration to buckets: a skill dropped straight into skills/ would silently
  // vanish from the catalog, so name it loudly instead of ignoring it.
  for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (fs.existsSync(path.join(SKILLS_DIR, entry.name, 'SKILL.md'))) {
      warnings.push(
        `skills/${entry.name}/ sits outside a bucket — move it into one of: ${BUCKETS.join(', ')}`
      );
    } else if (!BUCKETS.includes(entry.name) && !entry.name.endsWith('-workspace')) {
      warnings.push(`skills/${entry.name}/ is not a known bucket — ignored`);
    }
  }

  // Ordered by bucket first (in the caller's bucket order), then by name within each.
  // The CLI numbers this list flat while displaying it grouped, so a name-only sort would
  // scatter each bucket's indices (productivity showing "3" and "5").
  for (const bucket of buckets) {
    const bucketDir = path.join(SKILLS_DIR, bucket);
    if (!fs.existsSync(bucketDir)) continue;
    const inBucket = [];
    for (const entry of fs.readdirSync(bucketDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      // A directory without a SKILL.md is simply not a skill (e.g. a workspace) — skip
      // it silently. Only warn when a skill is present but malformed.
      if (!fs.existsSync(path.join(bucketDir, entry.name, 'SKILL.md'))) continue;
      try {
        inBucket.push(loadSkillFromDir(path.join(bucketDir, entry.name), bucket));
      } catch (err) {
        warnings.push(`skipped ${bucket}/${entry.name}: ${err.message}`);
      }
    }
    inBucket.sort((a, b) => a.name.localeCompare(b.name));
    skills.push(...inBucket);
  }
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
  PROMOTED_BUCKETS,
  UNPROMOTED_BUCKETS,
  BUCKETS,
  INVOCATIONS,
  PLATFORMS,
  PLATFORM_VALUES,
  parseFrontmatter,
  listFilesRecursive,
  loadSkill,
  loadSkillFromDir,
  scanSkills,
  loadCatalog,
};
