'use strict';

const fs = require('fs');
const path = require('path');

const { ROOT, CATALOG_FILE, PROMOTED_BUCKETS, scanSkills } = require('../cli/catalog');

const OWNER = 'krukovden';
const PLUGIN_NAME = 'skill-catalog';
const DESCRIPTION =
  'Extra skills extending Claude/Copilot/Codex base capabilities';

// Single source of truth for the release version. Claude compares plugin.json's `version`
// against the installed copy to decide whether users see an update, so it must move on
// every release — hardcoding it here (as this file used to) silently froze every
// installed plugin at its first version.
const { version: VERSION } = require(path.join(ROOT, 'package.json'));

function build() {
  // Promoted buckets only: skills under in-progress/ and deprecated/ live in the repo but
  // must never reach a user, and this single call is what enforces that for every
  // artifact written below.
  const { skills, warnings } = scanSkills({ buckets: PROMOTED_BUCKETS });
  warnings.forEach((w) => console.warn(`⚠ ${w}`));

  if (skills.length === 0) {
    console.error('✗ no promoted skills found — refusing to write an empty catalog');
    process.exit(1);
  }

  // 1. catalog.json — the runtime list the CLI reads (derived from skills/<bucket>/).
  const catalog = {
    name: 'skillcatalog',
    description: DESCRIPTION,
    version: VERSION,
    skills: skills.map((s) => ({
      name: s.name,
      description: s.description,
      bucket: s.bucket,
      path: s.path,
    })),
  };
  fs.writeFileSync(CATALOG_FILE, `${JSON.stringify(catalog, null, 2)}\n`);

  // 2. Claude marketplace + plugin manifests. The repo root is itself a single plugin.
  //    `skills` is an explicit array of directory paths rather than letting Claude
  //    auto-discover everything under skills/ — auto-discovery would also ship the
  //    unpromoted buckets, which is exactly what buckets exist to prevent.
  const pluginDir = path.join(ROOT, '.claude-plugin');
  fs.mkdirSync(pluginDir, { recursive: true });

  const marketplace = {
    name: 'skillcatalog',
    owner: { name: OWNER },
    plugins: [
      {
        name: PLUGIN_NAME,
        source: '.',
        description: DESCRIPTION,
      },
    ],
  };
  fs.writeFileSync(
    path.join(pluginDir, 'marketplace.json'),
    `${JSON.stringify(marketplace, null, 2)}\n`
  );

  const plugin = {
    name: PLUGIN_NAME,
    description: DESCRIPTION,
    version: VERSION,
    skills: skills.map((s) => `./${s.path}`),
  };
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    `${JSON.stringify(plugin, null, 2)}\n`
  );

  const byBucket = skills.reduce((acc, s) => {
    (acc[s.bucket] = acc[s.bucket] || []).push(s.name);
    return acc;
  }, {});
  const summary = Object.entries(byBucket)
    .map(([b, names]) => `${b}: ${names.join(', ')}`)
    .join(' | ');
  console.log(
    `Built catalog.json, marketplace.json, plugin.json — v${VERSION}, ` +
      `${skills.length} promoted skill(s) [${summary}]`
  );
}

build();
