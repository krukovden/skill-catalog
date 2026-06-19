'use strict';

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

    // 2. Select skills
    console.log('\nAvailable skills:');
    skills.forEach((s, i) => console.log(`  ${i + 1}. ${s.name} — ${s.description}`));
    const selAns = await prompter.ask('\nSelect (e.g. 1,3 or "all"): ');
    const indices = parseSelection(selAns, skills.length);
    if (indices.length === 0) {
      console.log('Nothing selected. Aborting.');
      return;
    }

    // 3. Confirm + install
    const chosen = indices.map((i) => skills[i]);
    console.log(`\nInstalling ${chosen.length} skill(s) for ${adapter.label} into ${projectDir}:`);
    const { loadSkill } = require('./catalog');
    for (const entry of chosen) {
      const skill = loadSkill(entry.name);
      const written = adapter.install(skill, projectDir);
      console.log(`  ✓ ${skill.name}`);
      written.forEach((w) => console.log(`      ${w}`));
    }
    console.log('\nDone.');
  } finally {
    prompter.close();
  }
}

module.exports = { run, parseSelection, ADAPTERS };
