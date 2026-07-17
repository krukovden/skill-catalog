'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Copilot adapter: write a self-contained custom-instructions file at
 * .github/instructions/<name>.instructions.md, inlining the skill body so the install
 * needs no external source tree to reference.
 */

const id = 'copilot';
const label = 'GitHub Copilot (.github/instructions/)';
// Copilot custom instructions live in the repo (.github/instructions/) and are inherently
// repo-scoped — there is no user-global location, so only local install is offered.
const supportsGlobal = false;

function render(skill) {
  return [
    '---',
    "applyTo: '**'",
    `description: ${JSON.stringify(skill.description)}`,
    '---',
    '',
    skill.body,
    '',
  ].join('\n');
}

/** Pure: returns the files this adapter would write, relative to the project dir. */
function outputs(skill) {
  return [
    {
      path: path.join('.github', 'instructions', `${skill.name}.instructions.md`),
      content: render(skill),
    },
  ];
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

module.exports = { id, label, supportsGlobal, outputs, render, install };
