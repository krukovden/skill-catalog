'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Claude adapter: copy the full skill directory tree to .claude/skills/<name>/.
 * This is the native Agent Skills layout.
 */

const id = 'claude';
const label = 'Claude Code (.claude/skills/)';
// Claude reads skills from <cwd>/.claude/skills (project) and ~/.claude/skills (global).
// Both are the same `.claude/skills/<name>/` layout — only the base dir differs, so a
// plain base swap in index.js is enough; the adapter needs no scope branching.
const supportsGlobal = true;

/** Pure: returns the files this adapter would write, relative to the project dir. */
function outputs(skill) {
  return skill.files.map((rel) => ({
    path: path.join('.claude', 'skills', skill.name, rel),
    content: fs.readFileSync(path.join(skill.dir, rel)),
  }));
}

function install(skill, projectDir) {
  const written = [];
  // Iterate the source files directly so we can preserve each file's mode — otherwise
  // executable helper scripts (ado.sh, checks.sh, …) install as 0644 and the skill's
  // `<dir>/scripts/foo.sh` invocations fail with "permission denied". Copying the exact
  // source mode (fixed in git as 100755/100644) keeps installs byte- AND mode-deterministic.
  for (const rel of skill.files) {
    const srcPath = path.join(skill.dir, rel);
    const relDest = path.join('.claude', 'skills', skill.name, rel);
    const dest = path.join(projectDir, relDest);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, fs.readFileSync(srcPath));
    fs.chmodSync(dest, fs.statSync(srcPath).mode & 0o777);
    written.push(relDest);
  }
  return written;
}

module.exports = { id, label, supportsGlobal, outputs, install };
