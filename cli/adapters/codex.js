'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Codex adapter: Codex has no skills concept and reads AGENTS.md. We write each skill's
 * full body to .codex/skills/<name>.md and maintain an idempotent managed block in
 * AGENTS.md that references the installed skills. Unrelated AGENTS.md content is preserved.
 */

const id = 'codex';
const label = 'OpenAI Codex (.codex/skills/ + AGENTS.md)';
// Local: skills at <cwd>/.codex/skills/, managed block in <cwd>/AGENTS.md.
// Global: skills at ~/.codex/skills/, managed block in ~/.codex/AGENTS.md.
// Only the AGENTS.md location and the in-block skill ref differ (see install()).
const supportsGlobal = true;

const START = '<!-- skillcatalog:start -->';
const END = '<!-- skillcatalog:end -->';

function skillFilePath(skill) {
  return path.join('.codex', 'skills', `${skill.name}.md`);
}

/** Pure: per-skill file output (the AGENTS.md merge is handled in install). */
function outputs(skill) {
  return [{ path: skillFilePath(skill), content: `${skill.body}\n` }];
}

/**
 * Pure: render the managed AGENTS.md block. `refPrefix` is the path the block uses to
 * point at each skill file, relative to the AGENTS.md that hosts it (`.codex/skills` when
 * AGENTS.md sits at a project root, `skills` when it sits inside ~/.codex/).
 */
function renderBlock(entries, refPrefix = '.codex/skills') {
  const lines = [START, '## SkillCatalog skills', ''];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`- **${e.name}** — see \`${refPrefix}/${e.name}.md\`: ${e.description}`);
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

/** Pure: merge a skill into AGENTS.md content, returning the new content. */
function mergeAgentsMd(existing, skill, refPrefix = '.codex/skills') {
  const entries = parseExistingEntries(existing).filter((e) => e.name !== skill.name);
  entries.push({ name: skill.name, description: skill.description });
  const block = renderBlock(entries, refPrefix);

  if (new RegExp(`${START}[\\s\\S]*?${END}`).test(existing)) {
    return existing.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
  }
  const prefix = existing.trim() === '' ? '' : `${existing.replace(/\s*$/, '')}\n\n`;
  return `${prefix}${block}\n`;
}

function install(skill, baseDir, scope = 'local') {
  const written = [];

  for (const out of outputs(skill)) {
    const dest = path.join(baseDir, out.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out.content);
    written.push(out.path);
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
  START,
  END,
};
