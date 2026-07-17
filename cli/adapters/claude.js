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
  for (const out of outputs(skill)) {
    const dest = path.join(projectDir, out.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out.content);
    written.push(out.path);
  }
  return written;
}

module.exports = { id, label, supportsGlobal, outputs, install };
