'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadSkillFromDir,
  parseFrontmatter,
  scanSkills,
  PROMOTED_BUCKETS,
  UNPROMOTED_BUCKETS,
  PLATFORMS,
} = require('../cli/catalog');
const claude = require('../cli/adapters/claude');
const copilot = require('../cli/adapters/copilot');
const codex = require('../cli/adapters/codex');
const { parseSelection, summarize } = require('../cli/index');

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

// Self-contained fixture skill — tests don't depend on any catalog content.
// The default body exercises both link styles a real skill uses: a markdown link into
// references/ and the `<SKILL_DIR>` placeholder into scripts/.
// `bare: true` ships SKILL.md and nothing else; `body` overrides the body text.
function makeFixtureSkill({ bare = false, body = null, frontmatter = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-fixture-'));
  const dir = path.join(root, 'sample-skill');
  fs.mkdirSync(dir, { recursive: true });

  const text =
    body ||
    (bare
      ? '# Sample Skill\n\nBody.'
      : '# Sample Skill\n\nSee [notes](references/notes.md), then run `<SKILL_DIR>/scripts/run.sh`.');
  const meta = ['name: sample-skill', 'description: A sample skill used by the test suite.'];
  if (frontmatter) meta.push(frontmatter);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${meta.join('\n')}\n---\n\n${text}\n`);

  if (!bare) {
    fs.mkdirSync(path.join(dir, 'references'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'references', 'notes.md'), 'notes\n');
    // An executable helper script — used to verify installs preserve the +x mode.
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    const sh = path.join(dir, 'scripts', 'run.sh');
    fs.writeFileSync(sh, '#!/usr/bin/env bash\necho hi\n');
    fs.chmodSync(sh, 0o755);
  }
  return loadSkillFromDir(dir);
}

const skill = makeFixtureSkill();

console.log('catalog');
test('loadSkillFromDir parses frontmatter and body', () => {
  assert.strictEqual(skill.name, 'sample-skill');
  assert.ok(skill.description.length > 0);
  assert.ok(skill.body.startsWith('# Sample Skill'));
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
test('parses a YAML folded block-scalar description', () => {
  const md = ['---', 'name: x', 'description: >-', '  line one', '  line two', '---', '', 'Body'].join('\n');
  const { frontmatter } = parseFrontmatter(md);
  assert.strictEqual(frontmatter.description, 'line one line two');
});

console.log('claude adapter');
test('outputs include the full tree under .claude/skills/<name>/', () => {
  const out = claude.outputs(skill);
  assert.ok(out.some((o) => o.path === path.join('.claude', 'skills', 'sample-skill', 'SKILL.md')));
  assert.ok(out.some((o) => o.path === path.join('.claude', 'skills', 'sample-skill', 'references', 'notes.md')));
});
test('install writes the file tree', () => {
  const dir = tmpProject();
  const written = claude.install(skill, dir);
  assert.ok(written.includes(path.join('.claude', 'skills', 'sample-skill', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'skills', 'sample-skill', 'references', 'notes.md')));
});
test('install preserves the executable bit on scripts (mode-deterministic)', () => {
  if (process.platform === 'win32') return; // POSIX mode bits are a no-op on Windows
  const dir = tmpProject();
  claude.install(skill, dir);
  const runSh = path.join(dir, '.claude', 'skills', 'sample-skill', 'scripts', 'run.sh');
  assert.ok(fs.statSync(runSh).mode & 0o111, 'installed script must stay executable');
  const notes = path.join(dir, '.claude', 'skills', 'sample-skill', 'references', 'notes.md');
  assert.ok(!(fs.statSync(notes).mode & 0o111), 'non-executable files must stay non-executable');
});

console.log('copilot adapter');
test('renders an instructions file with applyTo frontmatter', () => {
  const [out] = copilot.outputs(skill);
  assert.strictEqual(out.path, path.join('.github', 'instructions', 'sample-skill.instructions.md'));
  assert.ok(out.content.includes("applyTo: '**'"));
  assert.ok(out.content.includes('# Sample Skill'));
});
test('install writes the instructions file', () => {
  const dir = tmpProject();
  copilot.install(skill, dir);
  const p = path.join(dir, '.github', 'instructions', 'sample-skill.instructions.md');
  assert.ok(fs.existsSync(p));
});
test('the whole tree travels — attachments are not dropped', () => {
  const dir = tmpProject();
  copilot.install(skill, dir);
  const base = path.join(dir, '.github', 'skillcatalog', 'sample-skill');
  // Every file the skill ships must land, SKILL.md included so intra-skill links resolve
  // in both directions (a disclosed file linking back to SKILL.md).
  for (const rel of skill.files) {
    assert.ok(fs.existsSync(path.join(base, rel)), `${rel} was dropped`);
  }
});
test('install preserves the executable bit on copied scripts', () => {
  if (process.platform === 'win32') return;
  const dir = tmpProject();
  copilot.install(skill, dir);
  const runSh = path.join(dir, '.github', 'skillcatalog', 'sample-skill', 'scripts', 'run.sh');
  assert.ok(fs.statSync(runSh).mode & 0o111, 'installed script must stay executable');
});
test('a skill with attachments gets a base-path preamble', () => {
  const [out] = copilot.outputs(skill);
  assert.ok(copilot.hasAssets(skill));
  assert.ok(
    out.content.includes('.github/skillcatalog/sample-skill/'),
    'preamble must name the asset directory so relative paths resolve'
  );
});
test('a SKILL.md-only skill gets no preamble (no noise where nothing was installed)', () => {
  const bare = makeFixtureSkill({ bare: true });
  assert.ok(!copilot.hasAssets(bare));
  const [out] = copilot.outputs(bare);
  assert.ok(!out.content.includes('supporting files'), 'bare skill needs no preamble');
});
test('the <SKILL_DIR> placeholder resolves to the installed asset path', () => {
  const withPlaceholder = makeFixtureSkill({ body: 'Run `<SKILL_DIR>/scripts/run.sh` now.' });
  const [out] = copilot.outputs(withPlaceholder);
  assert.ok(out.content.includes('`.github/skillcatalog/sample-skill/scripts/run.sh`'));
  assert.ok(!out.content.includes('<SKILL_DIR>'), 'no placeholder may survive into the install');
});
test('every relative path the body references is actually installed', () => {
  // The regression that motivated this adapter rewrite: the body pointed at scripts/ and
  // references/ that the install never wrote.
  const dir = tmpProject();
  copilot.install(skill, dir);
  const content = fs.readFileSync(
    path.join(dir, '.github', 'instructions', 'sample-skill.instructions.md'),
    'utf8'
  );
  const referenced = new Set(
    [...content.matchAll(/(?:scripts|references)\/[A-Za-z0-9._-]+/g)].map((m) =>
      m[0].replace(`${copilot.assetDir(skill)}/`, '')
    )
  );
  for (const rel of referenced) {
    const target = path.join(dir, '.github', 'skillcatalog', 'sample-skill', rel);
    assert.ok(fs.existsSync(target), `body references ${rel} but it was not installed`);
  }
});

console.log('codex adapter');
test('install writes the full skill tree (incl. scripts) and AGENTS.md managed block', () => {
  const dir = tmpProject();
  codex.install(skill, dir);
  assert.ok(fs.existsSync(path.join(dir, '.codex', 'skills', 'sample-skill', 'SKILL.md')));
  // the whole tree comes along — not just the body
  assert.ok(fs.existsSync(path.join(dir, '.codex', 'skills', 'sample-skill', 'scripts', 'run.sh')));
  assert.ok(fs.existsSync(path.join(dir, '.codex', 'skills', 'sample-skill', 'references', 'notes.md')));
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes(codex.START) && agents.includes(codex.END));
  assert.ok(agents.includes('**sample-skill**'));
  assert.ok(agents.includes('`.codex/skills/sample-skill/SKILL.md`'));
});
test('codex install preserves the executable bit on scripts', () => {
  if (process.platform === 'win32') return;
  const dir = tmpProject();
  codex.install(skill, dir);
  const runSh = path.join(dir, '.codex', 'skills', 'sample-skill', 'scripts', 'run.sh');
  assert.ok(fs.statSync(runSh).mode & 0o111, 'installed codex script must stay executable');
});
test('merge preserves unrelated AGENTS.md content and is idempotent', () => {
  const original = '# My project rules\n\nDo nice things.\n';
  let merged = codex.mergeAgentsMd(original, skill);
  assert.ok(merged.includes('# My project rules'));
  // Re-merging the same skill must not duplicate the entry.
  merged = codex.mergeAgentsMd(merged, skill);
  const count = (merged.match(/\*\*sample-skill\*\*/g) || []).length;
  assert.strictEqual(count, 1);
});

console.log('install scope (local vs global)');
test('adapters declare supportsGlobal correctly', () => {
  assert.strictEqual(claude.supportsGlobal, true);
  assert.strictEqual(codex.supportsGlobal, true);
  assert.strictEqual(copilot.supportsGlobal, false);
});
test('claude global install uses the same layout under the base dir', () => {
  const home = tmpProject(); // stands in for ~ under a global install
  const written = claude.install(skill, home, 'global');
  assert.ok(written.includes(path.join('.claude', 'skills', 'sample-skill', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'sample-skill', 'SKILL.md')));
});
test('codex global puts AGENTS.md in .codex/ with a relative skills/ ref', () => {
  const home = tmpProject();
  codex.install(skill, home, 'global');
  const agentsPath = path.join(home, '.codex', 'AGENTS.md');
  assert.ok(fs.existsSync(agentsPath), 'AGENTS.md should live in .codex/ for global');
  assert.ok(fs.existsSync(path.join(home, '.codex', 'skills', 'sample-skill', 'SKILL.md')));
  const agents = fs.readFileSync(agentsPath, 'utf8');
  assert.ok(agents.includes('`skills/sample-skill/SKILL.md`'), 'ref should be relative to .codex/');
  assert.ok(!agents.includes('`.codex/skills/sample-skill/SKILL.md`'), 'must not use the project-root ref');
  // Idempotent + still parseable with the relaxed ref regex.
  const again = codex.mergeAgentsMd(agents, skill, 'skills');
  const count = (again.match(/\*\*sample-skill\*\*/g) || []).length;
  assert.strictEqual(count, 1);
});

console.log('cli selection');
test('parseSelection handles "all" and index lists', () => {
  assert.deepStrictEqual(parseSelection('all', 3), [0, 1, 2]);
  assert.deepStrictEqual(parseSelection('1,3', 3), [0, 2]);
  assert.deepStrictEqual(parseSelection('9', 3), []);
});
test('summarize keeps the first sentence and caps the length', () => {
  assert.strictEqual(summarize('Short one. Trigger list follows.'), 'Short one.');
  const long = `${'a'.repeat(200)}. Rest.`;
  const out = summarize(long);
  assert.ok(out.length <= 100, `expected <=100 chars, got ${out.length}`);
  assert.ok(out.endsWith('…'));
});

console.log('invocation + platforms');
const userSkill = makeFixtureSkill({ frontmatter: 'invocation: user' });

test('invocation defaults to model when frontmatter is silent', () => {
  assert.strictEqual(skill.invocation, 'model');
  assert.deepStrictEqual(skill.platforms, {});
});
test('an unknown invocation value is rejected, not ignored', () => {
  assert.throws(() => makeFixtureSkill({ frontmatter: 'invocation: sometimes' }), /invocation "sometimes"/);
});
test('an unknown platform id is rejected', () => {
  assert.throws(() => makeFixtureSkill({ frontmatter: 'platforms:\n  jetbrains: skip' }), /unknown platform/);
});
test('an unsupported platform value is rejected', () => {
  assert.throws(() => makeFixtureSkill({ frontmatter: 'platforms:\n  copilot: maybe' }), /only supported value/);
});
test('two-level frontmatter nesting fails loudly instead of flattening', () => {
  // The trap this schema was designed around: the parser holds one level, and used to
  // silently fold a second one into it — producing a corrupt skill that still built.
  assert.throws(
    () => parseFrontmatter(['---', 'name: x', 'description: y', 'platforms:', '  codex:', '    allow_implicit_invocation: false', '---', '', 'B'].join('\n')),
    /nests too deep/
  );
});
test('PLATFORMS matches the adapter ids exactly (no drift)', () => {
  assert.deepStrictEqual([...PLATFORMS].sort(), [claude.id, codex.id, copilot.id].sort());
});

test('claude injects disable-model-invocation for a user-invoked skill', () => {
  const out = claude.outputs(userSkill).find((o) => o.path.endsWith('SKILL.md'));
  assert.ok(out.content.toString().includes('disable-model-invocation: true'));
});
test('claude leaves a model-invoked SKILL.md byte-identical', () => {
  const out = claude.outputs(skill).find((o) => o.path.endsWith('SKILL.md'));
  const src = fs.readFileSync(path.join(skill.dir, 'SKILL.md'));
  assert.ok(out.content.equals(src), 'model-invoked skills must be copied verbatim');
});
test('claude injection is idempotent and keeps the body intact', () => {
  const once = claude.withDisableModelInvocation(fs.readFileSync(path.join(userSkill.dir, 'SKILL.md'), 'utf8'));
  const twice = claude.withDisableModelInvocation(once);
  assert.strictEqual(once, twice);
  assert.strictEqual((twice.match(/disable-model-invocation/g) || []).length, 1);
  assert.ok(twice.includes('# Sample Skill'));
});
test('claude injection only touches SKILL.md, not the rest of the tree', () => {
  const notes = claude.outputs(userSkill).find((o) => o.path.endsWith('notes.md'));
  assert.ok(notes.content.equals(fs.readFileSync(path.join(userSkill.dir, 'references', 'notes.md'))));
});

test('codex writes an openai.yaml policy only for user-invoked skills', () => {
  const policy = codex.outputs(userSkill).find((o) => o.path.endsWith(codex.POLICY_FILE));
  assert.ok(policy, 'user-invoked skill must get agents/openai.yaml');
  assert.ok(policy.content.includes('allow_implicit_invocation: false'));
  assert.strictEqual(codex.outputs(skill).find((o) => o.path.endsWith(codex.POLICY_FILE)), undefined);
});
test('codex keeps user-invoked skills out of the AGENTS.md model index', () => {
  const merged = codex.mergeAgentsMd('', userSkill);
  assert.ok(!merged.includes('**sample-skill**'), 'the block is the model index; a user-invoked skill has no place in it');
});
test('codex removes a skill from AGENTS.md when it becomes user-invoked', () => {
  const listed = codex.mergeAgentsMd('# rules\n', skill);
  assert.ok(listed.includes('**sample-skill**'));
  const delisted = codex.mergeAgentsMd(listed, userSkill);
  assert.ok(!delisted.includes('**sample-skill**'), 'a stale entry must not survive the switch');
  assert.ok(delisted.includes('# rules'), 'unrelated content still survives');
});

test('copilot skips a user-invoked skill and says why', () => {
  assert.match(copilot.skipReason(userSkill), /user-invoked/);
  assert.deepStrictEqual(copilot.outputs(userSkill), []);
  assert.deepStrictEqual(copilot.install(userSkill, tmpProject()), []);
});
test('copilot honours an explicit platforms.copilot: skip', () => {
  const optedOut = makeFixtureSkill({ frontmatter: 'platforms:\n  copilot: skip' });
  assert.match(copilot.skipReason(optedOut), /opts out/);
  assert.deepStrictEqual(copilot.outputs(optedOut), []);
});
test('copilot still installs an ordinary model-invoked skill', () => {
  assert.strictEqual(copilot.skipReason(skill), null);
  assert.ok(copilot.outputs(skill).length > 1);
});

console.log('buckets');
test('scanSkills returns only promoted buckets by default', () => {
  const { skills } = scanSkills();
  assert.ok(skills.length > 0, 'expected at least one promoted skill');
  for (const s of skills) {
    assert.ok(
      PROMOTED_BUCKETS.includes(s.bucket),
      `${s.name} is in "${s.bucket}", which is not a promoted bucket`
    );
  }
});
test('every scanned skill carries its bucket and repo-relative path', () => {
  const { skills } = scanSkills();
  for (const s of skills) {
    assert.strictEqual(s.path, `skills/${s.bucket}/${s.name}`);
  }
});
test('unpromoted buckets are reachable only when asked for explicitly', () => {
  const promoted = scanSkills().skills.map((s) => s.name);
  const unpromoted = scanSkills({ buckets: UNPROMOTED_BUCKETS }).skills.map((s) => s.name);
  const leaked = unpromoted.filter((n) => promoted.includes(n));
  assert.deepStrictEqual(leaked, [], 'an unpromoted skill leaked into the default scan');
});
test('no skill sits outside a bucket', () => {
  const { warnings } = scanSkills();
  const stray = warnings.filter((w) => w.includes('outside a bucket'));
  assert.deepStrictEqual(stray, [], stray.join('; '));
});

console.log('e2e: build output');
const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

test('marketplace.json is valid after build', () => {
  const mp = path.join(__dirname, '..', '.claude-plugin', 'marketplace.json');
  assert.ok(fs.existsSync(mp), 'run `npm run build` first');
  const json = JSON.parse(fs.readFileSync(mp, 'utf8'));
  assert.ok(json.name && Array.isArray(json.plugins) && json.plugins.length > 0);
});
test('plugin.json version tracks package.json (else installs never update)', () => {
  const pkg = readJson('package.json');
  const plugin = readJson('.claude-plugin', 'plugin.json');
  assert.strictEqual(plugin.version, pkg.version);
  assert.strictEqual(readJson('catalog.json').version, pkg.version);
});
test('plugin.json lists promoted skill paths explicitly, not by auto-discovery', () => {
  const plugin = readJson('.claude-plugin', 'plugin.json');
  const expected = scanSkills().skills.map((s) => `./${s.path}`);
  assert.ok(Array.isArray(plugin.skills), 'plugin.json must carry an explicit skills array');
  assert.deepStrictEqual(plugin.skills.slice().sort(), expected.slice().sort());
});
test('no unpromoted skill reaches catalog.json or plugin.json', () => {
  const shipped = new Set([
    ...readJson('catalog.json').skills.map((s) => s.name),
    ...readJson('.claude-plugin', 'plugin.json').skills.map((p) => path.basename(p)),
  ]);
  for (const s of scanSkills({ buckets: UNPROMOTED_BUCKETS }).skills) {
    assert.ok(!shipped.has(s.name), `${s.bucket}/${s.name} must not ship`);
  }
});
test('catalog.json matches what a fresh scan produces (build is up to date)', () => {
  const onDisk = readJson('catalog.json').skills.map((s) => `${s.bucket}/${s.name}`).sort();
  const scanned = scanSkills().skills.map((s) => `${s.bucket}/${s.name}`).sort();
  assert.deepStrictEqual(onDisk, scanned, 'run `npm run build`');
});
test('every bucket has a README.md', () => {
  for (const bucket of [...PROMOTED_BUCKETS, ...UNPROMOTED_BUCKETS]) {
    const dir = path.join(__dirname, '..', 'skills', bucket);
    if (!fs.existsSync(dir)) continue;
    assert.ok(fs.existsSync(path.join(dir, 'README.md')), `skills/${bucket}/README.md missing`);
  }
});

console.log(`\n${passed} passed`);
