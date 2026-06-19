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

const START = '<!-- skillcatalog:start -->';
const END = '<!-- skillcatalog:end -->';

function skillFilePath(skill) {
  return path.join('.codex', 'skills', `${skill.name}.md`);
}

/** Pure: per-skill file output (the AGENTS.md merge is handled in install). */
function outputs(skill) {
  return [{ path: skillFilePath(skill), content: `${skill.body}\n` }];
}

/** Pure: render the managed AGENTS.md block for a set of {name, description} entries. */
function renderBlock(entries) {
  const lines = [START, '## SkillCatalog skills', ''];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`- **${e.name}** — see \`.codex/skills/${e.name}.md\`: ${e.description}`);
  }
  lines.push('', END);
  return lines.join('\n');
}

/** Pure: extract existing managed entries from an AGENTS.md string. */
function parseExistingEntries(agentsMd) {
  const block = new RegExp(`${START}[\\s\\S]*?${END}`).exec(agentsMd);
  if (!block) return [];
  const entries = [];
  const re = /^- \*\*(.+?)\*\* — see `\.codex\/skills\/.+?`: ([\s\S]*?)$/gm;
  let m;
  while ((m = re.exec(block[0])) !== null) {
    entries.push({ name: m[1], description: m[2].trim() });
  }
  return entries;
}

/** Pure: merge a skill into AGENTS.md content, returning the new content. */
function mergeAgentsMd(existing, skill) {
  const entries = parseExistingEntries(existing).filter((e) => e.name !== skill.name);
  entries.push({ name: skill.name, description: skill.description });
  const block = renderBlock(entries);

  if (new RegExp(`${START}[\\s\\S]*?${END}`).test(existing)) {
    return existing.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
  }
  const prefix = existing.trim() === '' ? '' : `${existing.replace(/\s*$/, '')}\n\n`;
  return `${prefix}${block}\n`;
}

function install(skill, projectDir) {
  const written = [];

  for (const out of outputs(skill)) {
    const dest = path.join(projectDir, out.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out.content);
    written.push(out.path);
  }

  const agentsPath = path.join(projectDir, 'AGENTS.md');
  const existing = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : '';
  fs.writeFileSync(agentsPath, mergeAgentsMd(existing, skill));
  written.push('AGENTS.md');

  return written;
}

module.exports = {
  id,
  label,
  outputs,
  install,
  renderBlock,
  parseExistingEntries,
  mergeAgentsMd,
  START,
  END,
};
