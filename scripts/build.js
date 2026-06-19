'use strict';

const fs = require('fs');
const path = require('path');

const { ROOT, CATALOG_FILE, scanSkills } = require('../cli/catalog');

const OWNER = 'krukovden';
const PLUGIN_NAME = 'skill-catalog';
const DESCRIPTION =
  'Extra skills extending Claude/Copilot/Codex base capabilities';

function build() {
  const { skills, warnings } = scanSkills();
  warnings.forEach((w) => console.warn(`⚠ ${w}`));

  // 1. catalog.json — the runtime list the CLI reads (derived from skills/).
  const catalog = {
    name: 'skillcatalog',
    description: DESCRIPTION,
    skills: skills.map((s) => ({
      name: s.name,
      description: s.description,
      path: `skills/${s.name}`,
    })),
  };
  fs.writeFileSync(CATALOG_FILE, `${JSON.stringify(catalog, null, 2)}\n`);

  // 2. Claude marketplace + plugin manifests. The repo root is itself a single plugin
  //    whose skills/ dir Claude auto-discovers. Native install = the whole bundle;
  //    fine-grained per-skill selection is available via the CLI on any platform.
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
    version: '0.1.0',
  };
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    `${JSON.stringify(plugin, null, 2)}\n`
  );

  console.log(
    `Built catalog.json (${skills.length} skill(s)), marketplace.json, plugin.json`
  );
}

build();
