'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Claude adapter: copy the full skill directory tree to .claude/skills/<name>/.
 * This is the native Agent Skills layout.
 *
 * The one file that is not copied byte-for-byte is SKILL.md of a user-invoked skill:
 * Claude expresses "only the human may fire this" as `disable-model-invocation: true` in
 * frontmatter, and the catalog stores that decision platform-neutrally as
 * `invocation: user`. Translating it here is what keeps the source host-agnostic.
 */

const id = 'claude';
const label = 'Claude Code (.claude/skills/)';
// Claude reads skills from <cwd>/.claude/skills (project) and ~/.claude/skills (global).
// Both are the same `.claude/skills/<name>/` layout — only the base dir differs, so a
// plain base swap in index.js is enough; the adapter needs no scope branching.
const supportsGlobal = true;

const SKILL_FILE = 'SKILL.md';
const FLAG = 'disable-model-invocation: true';

/**
 * Pure: add `disable-model-invocation: true` to a SKILL.md's frontmatter, immediately
 * before its closing fence. Idempotent — a source that already sets it is returned as is.
 */
function withDisableModelInvocation(raw) {
  const fence = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)/;
  const match = fence.exec(raw);
  if (!match) throw new Error('SKILL.md has no frontmatter to mark as user-invoked');
  if (/^disable-model-invocation:/m.test(match[2])) return raw;
  return raw.replace(fence, (_full, open, inner, close) => `${open}${inner}\n${FLAG}${close}`);
}

/** Pure: the bytes to install for one of the skill's files. */
function contentFor(skill, rel) {
  const raw = fs.readFileSync(path.join(skill.dir, rel));
  if (rel !== SKILL_FILE || skill.invocation !== 'user') return raw;
  return Buffer.from(withDisableModelInvocation(raw.toString('utf8')), 'utf8');
}

/** Pure: returns the files this adapter would write, relative to the project dir. */
function outputs(skill) {
  return skill.files.map((rel) => ({
    path: path.join('.claude', 'skills', skill.name, rel),
    content: contentFor(skill, rel),
  }));
}

function install(skill, projectDir) {
  const written = [];
  // Iterate the source files directly so we can preserve each file's mode — otherwise
  // executable helper scripts (ado.sh, checks.sh, …) install as 0644 and the skill's
  // `<dir>/scripts/foo.sh` invocations fail with "permission denied". Copying the exact
  // source mode (fixed in git as 100755/100644) keeps installs mode-deterministic.
  for (const rel of skill.files) {
    const srcPath = path.join(skill.dir, rel);
    const relDest = path.join('.claude', 'skills', skill.name, rel);
    const dest = path.join(projectDir, relDest);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, contentFor(skill, rel));
    fs.chmodSync(dest, fs.statSync(srcPath).mode & 0o777);
    written.push(relDest);
  }
  return written;
}

module.exports = { id, label, supportsGlobal, outputs, install, withDisableModelInvocation };
