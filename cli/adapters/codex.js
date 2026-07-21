'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Codex adapter: Codex has no skills concept and reads AGENTS.md. We install each skill's
 * FULL directory tree (SKILL.md + scripts/ + references/…) under .codex/skills/<name>/ and
 * maintain an idempotent managed block in AGENTS.md that points at the skill's SKILL.md.
 * Copying the whole tree (not just the body) means skills that ship helper scripts work
 * under Codex too. Unrelated AGENTS.md content is preserved.
 */

const id = 'codex';
const label = 'OpenAI Codex (.codex/skills/ + AGENTS.md)';
// Local: skills at <cwd>/.codex/skills/<name>/, managed block in <cwd>/AGENTS.md.
// Global: skills at ~/.codex/skills/<name>/, managed block in ~/.codex/AGENTS.md.
// Only the AGENTS.md location and the in-block skill ref differ (see install()).
const supportsGlobal = true;

const START = '<!-- skillcatalog:start -->';
const END = '<!-- skillcatalog:end -->';

const POLICY_FILE = path.join('agents', 'openai.yaml');

/**
 * Pure: the sidecar Codex reads for invocation policy, or null when the skill is
 * model-invoked (the default needs no file). Codex expresses "only the human may fire
 * this" here, where Claude expresses it in SKILL.md frontmatter.
 */
function policyYaml(skill) {
  if (skill.invocation !== 'user') return null;
  return ['policy:', '  allow_implicit_invocation: false', ''].join('\n');
}

/** Pure: every file this adapter writes for a skill (the full tree), relative to base dir. */
function outputs(skill) {
  const out = skill.files.map((rel) => ({
    path: path.join('.codex', 'skills', skill.name, rel),
    content: fs.readFileSync(path.join(skill.dir, rel)),
  }));
  const policy = policyYaml(skill);
  if (policy) {
    out.push({ path: path.join('.codex', 'skills', skill.name, POLICY_FILE), content: policy });
  }
  return out;
}

/**
 * Pure: render the managed AGENTS.md block. `refPrefix` is the path the block uses to
 * point at each skill's SKILL.md, relative to the AGENTS.md that hosts it (`.codex/skills`
 * when AGENTS.md sits at a project root, `skills` when it sits inside ~/.codex/).
 */
function renderBlock(entries, refPrefix = '.codex/skills') {
  const lines = [START, '## SkillCatalog skills', ''];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`- **${e.name}** — see \`${refPrefix}/${e.name}/SKILL.md\`: ${e.description}`);
  }
  lines.push('', END);
  return lines.join('\n');
}

/** Pure: extract existing managed entries from an AGENTS.md string (either ref style). */
function parseExistingEntries(agentsMd) {
  const block = new RegExp(`${START}[\\s\\S]*?${END}`).exec(agentsMd);
  if (!block) return [];
  const entries = [];
  const re = /^- \*\*(.+?)\*\* — see `(?:\.codex\/)?skills\/.+?`: ([\s\S]*?)$/gm;
  let m;
  while ((m = re.exec(block[0])) !== null) {
    entries.push({ name: m[1], description: m[2].trim() });
  }
  return entries;
}

/**
 * Pure: merge a skill into AGENTS.md content, returning the new content.
 *
 * The managed block is the model's index of what it may reach for, so a user-invoked skill
 * is removed from it rather than listed — including when a skill that used to be
 * model-invoked becomes user-invoked, which is why the entry is filtered out before the
 * invocation is checked.
 */
function mergeAgentsMd(existing, skill, refPrefix = '.codex/skills') {
  const entries = parseExistingEntries(existing).filter((e) => e.name !== skill.name);
  if (skill.invocation !== 'user') {
    entries.push({ name: skill.name, description: skill.description });
  }
  const block = renderBlock(entries, refPrefix);

  if (new RegExp(`${START}[\\s\\S]*?${END}`).test(existing)) {
    return existing.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
  }
  const prefix = existing.trim() === '' ? '' : `${existing.replace(/\s*$/, '')}\n\n`;
  return `${prefix}${block}\n`;
}

function install(skill, baseDir, scope = 'local') {
  const written = [];

  // Copy the full skill tree, preserving each file's mode (executable scripts stay +x).
  for (const rel of skill.files) {
    const srcPath = path.join(skill.dir, rel);
    const relDest = path.join('.codex', 'skills', skill.name, rel);
    const dest = path.join(baseDir, relDest);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, fs.readFileSync(srcPath));
    fs.chmodSync(dest, fs.statSync(srcPath).mode & 0o777);
    written.push(relDest);
  }

  const policy = policyYaml(skill);
  if (policy) {
    const relDest = path.join('.codex', 'skills', skill.name, POLICY_FILE);
    const dest = path.join(baseDir, relDest);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, policy);
    written.push(relDest);
  }

  // Global install co-locates AGENTS.md inside ~/.codex next to the skills;
  // local install keeps it at the project root pointing into .codex/skills.
  const agentsRel = scope === 'global' ? path.join('.codex', 'AGENTS.md') : 'AGENTS.md';
  const refPrefix = scope === 'global' ? 'skills' : '.codex/skills';
  const agentsPath = path.join(baseDir, agentsRel);
  fs.mkdirSync(path.dirname(agentsPath), { recursive: true });
  const existing = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : '';
  fs.writeFileSync(agentsPath, mergeAgentsMd(existing, skill, refPrefix));
  written.push(agentsRel);

  return written;
}

module.exports = {
  id,
  label,
  supportsGlobal,
  outputs,
  install,
  renderBlock,
  parseExistingEntries,
  mergeAgentsMd,
  policyYaml,
  START,
  END,
  POLICY_FILE,
};
