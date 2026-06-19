'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadSkill, parseFrontmatter } = require('../cli/catalog');
const claude = require('../cli/adapters/claude');
const copilot = require('../cli/adapters/copilot');
const codex = require('../cli/adapters/codex');
const { parseSelection } = require('../cli/index');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skillcatalog-'));
}

const skill = loadSkill('demo-skill');

console.log('catalog');
test('loadSkill parses frontmatter and body', () => {
  assert.strictEqual(skill.name, 'demo-skill');
  assert.ok(skill.description.length > 0);
  assert.ok(skill.body.startsWith('# Demo Skill'));
});
test('tolerates an extra nested frontmatter block without breaking', () => {
  const md = [
    '---',
    'name: x',
    'description: y',
    'meta:',
    '  a: 1',
    '  b: two',
    '---',
    '',
    '# Body',
  ].join('\n');
  const { frontmatter, body } = parseFrontmatter(md);
  assert.strictEqual(frontmatter.name, 'x');
  assert.deepStrictEqual(frontmatter.meta, { a: '1', b: 'two' });
  assert.strictEqual(body, '# Body');
});

console.log('claude adapter');
test('outputs include SKILL.md under .claude/skills/<name>/', () => {
  const out = claude.outputs(skill);
  assert.ok(out.some((o) => o.path === path.join('.claude', 'skills', 'demo-skill', 'SKILL.md')));
});
test('install writes the file tree', () => {
  const dir = tmpProject();
  const written = claude.install(skill, dir);
  assert.ok(written.includes(path.join('.claude', 'skills', 'demo-skill', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'skills', 'demo-skill', 'SKILL.md')));
});

console.log('copilot adapter');
test('renders an instructions file with applyTo frontmatter', () => {
  const [out] = copilot.outputs(skill);
  assert.strictEqual(out.path, path.join('.github', 'instructions', 'demo-skill.instructions.md'));
  assert.ok(out.content.includes("applyTo: '**'"));
  assert.ok(out.content.includes('# Demo Skill'));
});
test('install writes the instructions file', () => {
  const dir = tmpProject();
  copilot.install(skill, dir);
  const p = path.join(dir, '.github', 'instructions', 'demo-skill.instructions.md');
  assert.ok(fs.existsSync(p));
});

console.log('codex adapter');
test('install writes skill file and AGENTS.md managed block', () => {
  const dir = tmpProject();
  codex.install(skill, dir);
  assert.ok(fs.existsSync(path.join(dir, '.codex', 'skills', 'demo-skill.md')));
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes(codex.START) && agents.includes(codex.END));
  assert.ok(agents.includes('**demo-skill**'));
});
test('merge preserves unrelated AGENTS.md content and is idempotent', () => {
  const original = '# My project rules\n\nDo nice things.\n';
  let merged = codex.mergeAgentsMd(original, skill);
  assert.ok(merged.includes('# My project rules'));
  // Re-merging the same skill must not duplicate the entry.
  merged = codex.mergeAgentsMd(merged, skill);
  const count = (merged.match(/\*\*demo-skill\*\*/g) || []).length;
  assert.strictEqual(count, 1);
});

console.log('cli selection');
test('parseSelection handles "all" and index lists', () => {
  assert.deepStrictEqual(parseSelection('all', 3), [0, 1, 2]);
  assert.deepStrictEqual(parseSelection('1,3', 3), [0, 2]);
  assert.deepStrictEqual(parseSelection('9', 3), []);
});

console.log('e2e: build output');
test('marketplace.json is valid after build', () => {
  const mp = path.join(__dirname, '..', '.claude-plugin', 'marketplace.json');
  assert.ok(fs.existsSync(mp), 'run `npm run build` first');
  const json = JSON.parse(fs.readFileSync(mp, 'utf8'));
  assert.ok(json.name && Array.isArray(json.plugins) && json.plugins.length > 0);
});

console.log(`\n${passed} passed`);
