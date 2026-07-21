'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Copilot adapter. Copilot has no skill concept — it reads custom-instruction files from
 * .github/instructions/ and applies them by glob. So the skill body is inlined into
 * .github/instructions/<name>.instructions.md, which acts as the entry point.
 *
 * The rest of the skill tree (scripts/, references/, sibling docs like GLOSSARY.md) is
 * copied verbatim to .github/skillcatalog/<name>/. Inlining the body alone used to be the
 * whole install, which silently dropped every attachment and left the instructions
 * pointing at files that were never written — `azure-reviewer` told the agent to run
 * `ado.sh` that did not exist.
 *
 * Relative links inside the body are NOT rewritten: the bodies use at least three link
 * styles (`<SKILL_DIR>/scripts/x.sh`, `[text](references/y.md)`, bare `` `scripts/z.sh` ``)
 * and regex-rewriting arbitrary markdown is fragile. Instead the file gets a one-line
 * preamble naming the base directory every relative path resolves against, and the single
 * literal placeholder `<SKILL_DIR>` — which exists precisely to be substituted — is
 * replaced with that path.
 */

const id = 'copilot';
const label = 'GitHub Copilot (.github/instructions/ + .github/skillcatalog/)';
// Copilot custom instructions live in the repo (.github/) and are inherently repo-scoped —
// there is no user-global location, so only local install is offered.
const supportsGlobal = false;

const INSTRUCTIONS_DIR = path.join('.github', 'instructions');
const ASSET_ROOT = path.join('.github', 'skillcatalog');

/**
 * Pure: why this skill cannot be installed for Copilot, or null when it can.
 *
 * Copilot has no invocation concept at all — instruction files are applied by glob, always.
 * So a user-invoked skill would be the worst of both worlds here: permanently loaded and
 * impossible to invoke deliberately. Skipping is the honest outcome, and saying so beats
 * installing something that cannot behave as authored.
 */
function skipReason(skill) {
  if (skill.platforms && skill.platforms.copilot === 'skip') {
    return 'the skill opts out of Copilot (platforms.copilot: skip)';
  }
  if (skill.invocation === 'user') {
    return 'it is user-invoked, and Copilot instructions are always-on with no way to invoke them';
  }
  return null;
}

/** Pure: posix path of the skill's asset directory, as referenced from inside the body. */
function assetDir(skill) {
  return path.posix.join('.github', 'skillcatalog', skill.name);
}

/** Pure: true when the skill ships anything beyond SKILL.md that must travel with it. */
function hasAssets(skill) {
  return skill.files.some((rel) => rel !== 'SKILL.md');
}

/** Pure: the instructions-file content — frontmatter, base-path preamble, inlined body. */
function render(skill) {
  const base = assetDir(skill);
  // `<SKILL_DIR>` is a literal placeholder the skill bodies use for their own directory;
  // substituting it is safe in a way that rewriting real markdown links is not.
  const body = skill.body.split('<SKILL_DIR>').join(base);

  const lines = ['---', "applyTo: '**'", `description: ${JSON.stringify(skill.description)}`, '---', ''];
  if (hasAssets(skill)) {
    lines.push(
      `> This skill ships supporting files (scripts, references) installed at \`${base}/\`.`,
      '> Resolve every relative path mentioned below against that directory.',
      ''
    );
  }
  lines.push(body, '');
  return lines.join('\n');
}

/** Pure: returns the files this adapter would write, relative to the project dir. */
function outputs(skill) {
  if (skipReason(skill)) return [];
  const out = [
    {
      path: path.join(INSTRUCTIONS_DIR, `${skill.name}.instructions.md`),
      content: render(skill),
    },
  ];
  // The full tree travels, SKILL.md included, so intra-skill links resolve in both
  // directions (GLOSSARY.md links back to SKILL.md).
  for (const rel of skill.files) {
    out.push({
      path: path.join(ASSET_ROOT, skill.name, rel),
      content: fs.readFileSync(path.join(skill.dir, rel)),
    });
  }
  return out;
}

function install(skill, projectDir) {
  const written = [];
  if (skipReason(skill)) return written;

  const instructionsRel = path.join(INSTRUCTIONS_DIR, `${skill.name}.instructions.md`);
  const instructionsDest = path.join(projectDir, instructionsRel);
  fs.mkdirSync(path.dirname(instructionsDest), { recursive: true });
  fs.writeFileSync(instructionsDest, render(skill));
  written.push(instructionsRel);

  // Copy from source so each file's mode survives — executable helper scripts installed
  // as 0644 fail at runtime with "permission denied".
  for (const rel of skill.files) {
    const srcPath = path.join(skill.dir, rel);
    const relDest = path.join(ASSET_ROOT, skill.name, rel);
    const dest = path.join(projectDir, relDest);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, fs.readFileSync(srcPath));
    fs.chmodSync(dest, fs.statSync(srcPath).mode & 0o777);
    written.push(relDest);
  }

  return written;
}

module.exports = {
  id,
  label,
  supportsGlobal,
  outputs,
  render,
  install,
  assetDir,
  hasAssets,
  skipReason,
  ASSET_ROOT,
  INSTRUCTIONS_DIR,
};
