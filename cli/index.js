'use strict';

const os = require('os');
const path = require('path');
const readline = require('readline');

const { loadCatalog } = require('./catalog');
const claude = require('./adapters/claude');
const copilot = require('./adapters/copilot');
const codex = require('./adapters/codex');

const ADAPTERS = { claude, copilot, codex };

/**
 * Line-queue prompter that works for both interactive TTY and piped (non-TTY) stdin.
 * Sequential readline.question() calls drop lines on piped EOF, so we buffer every line
 * and hand them out one ask() at a time, resolving to '' once input is exhausted.
 */
function createPrompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const queue = [];
  const waiters = [];
  let closed = false;

  rl.on('line', (line) => {
    if (waiters.length) waiters.shift()(line);
    else queue.push(line);
  });
  rl.on('close', () => {
    closed = true;
    while (waiters.length) waiters.shift()('');
  });

  function ask(prompt) {
    process.stdout.write(prompt);
    return new Promise((resolve) => {
      if (queue.length) resolve(queue.shift());
      else if (closed) resolve('');
      else waiters.push(resolve);
    }).then((a) => String(a).trim());
  }

  return { ask, close: () => rl.close() };
}

/**
 * Pure: one-line summary of a skill description for the picker. Descriptions are written
 * for the model and carry long trigger lists, which makes the menu unreadable — keep the
 * leading sentence and cap the length.
 */
function summarize(description, max = 100) {
  const firstSentence = String(description).split(/(?<=\.)\s+/)[0].trim();
  if (firstSentence.length <= max) return firstSentence;
  return `${firstSentence.slice(0, max - 1).trimEnd()}…`;
}

/** Parse a selection string like "1,3" or "all" against a list length. Returns indices. */
function parseSelection(input, length) {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === 'all') return [...Array(length).keys()];
  const indices = [];
  for (const part of trimmed.split(',')) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isInteger(n) && n >= 1 && n <= length) indices.push(n - 1);
  }
  return [...new Set(indices)];
}

async function run(argv = []) {
  const projectDir = process.cwd();
  const catalog = loadCatalog();
  const skills = catalog.skills || [];

  if (skills.length === 0) {
    console.log('No skills found in catalog. Run `npm run build` in the catalog repo.');
    return;
  }

  const prompter = createPrompter();
  try {
    // 1. Choose platform
    console.log('\nWhich platform?');
    const adapterList = Object.values(ADAPTERS);
    adapterList.forEach((a, i) => console.log(`  ${i + 1}. ${a.label}`));
    const platformAns = await prompter.ask('> ');
    const adapter = adapterList[Number.parseInt(platformAns, 10) - 1];
    if (!adapter) {
      console.log('Unknown platform. Aborting.');
      return;
    }

    // 2. Select skills, grouped by bucket. Numbering stays flat and global so the
    //    selection syntax ("1,3") is unaffected by how the list is grouped.
    console.log('\nAvailable skills:');
    const groups = new Map();
    skills.forEach((s, i) => {
      const bucket = s.bucket || 'skills';
      if (!groups.has(bucket)) groups.set(bucket, []);
      groups.get(bucket).push({ skill: s, index: i });
    });
    for (const [bucket, entries] of groups) {
      console.log(`\n  ${bucket}/`);
      for (const { skill, index } of entries) {
        const mark = skill.invocation === 'user' ? ' [type it]' : '';
        console.log(`    ${index + 1}. ${skill.name}${mark} — ${summarize(skill.description)}`);
      }
    }
    const selAns = await prompter.ask('\nSelect (e.g. 1,3 or "all"): ');
    const indices = parseSelection(selAns, skills.length);
    if (indices.length === 0) {
      console.log('Nothing selected. Aborting.');
      return;
    }

    // 3. Choose scope (local project vs global user-home) — only where it applies.
    let scope = 'local';
    let baseDir = projectDir;
    if (adapter.supportsGlobal) {
      console.log('\nInstall where?');
      console.log(`  1. This project (${projectDir})`);
      console.log(`  2. Global — all projects (${os.homedir()})`);
      const scopeAns = await prompter.ask('> ');
      if (scopeAns === '2') {
        scope = 'global';
        baseDir = os.homedir();
      } else if (scopeAns !== '1' && scopeAns !== '') {
        console.log('Unknown choice. Aborting.');
        return;
      }
    } else {
      console.log(`\n${adapter.label} is project-scoped — installing locally.`);
    }

    // 4. Confirm + install
    const chosen = indices.map((i) => skills[i]);
    const skipped = [];
    console.log(`\nInstalling ${chosen.length} skill(s) for ${adapter.label} (${scope}) into ${baseDir}:`);
    const { ROOT, loadSkill, loadSkillFromDir } = require('./catalog');
    for (const entry of chosen) {
      // Prefer the bucket path recorded at build time; fall back to a by-name search so a
      // catalog.json generated before buckets still installs.
      const skill = entry.path
        ? loadSkillFromDir(path.join(ROOT, entry.path), entry.bucket || null)
        : loadSkill(entry.name);

      // A platform that cannot express what the skill needs says so out loud — a silent
      // no-op would read as a successful install.
      const reason = adapter.skipReason ? adapter.skipReason(skill) : null;
      if (reason) {
        skipped.push(skill.name);
        console.log(`  – ${skill.name} — skipped: ${reason}`);
        continue;
      }

      const written = adapter.install(skill, baseDir, scope);
      console.log(`  ✓ ${skill.name}`);
      written.forEach((w) => console.log(`      ${w}`));
    }
    if (skipped.length) {
      console.log(`\nDone — ${chosen.length - skipped.length} installed, ${skipped.length} skipped (${skipped.join(', ')}).`);
      return;
    }
    console.log('\nDone.');
  } finally {
    prompter.close();
  }
}

module.exports = { run, parseSelection, summarize, ADAPTERS };
