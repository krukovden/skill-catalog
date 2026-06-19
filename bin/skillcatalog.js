#!/usr/bin/env node
'use strict';

const { run } = require('../cli/index');

run(process.argv.slice(2)).catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
