#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { STAGES } from '@recipe/core';

const HELP = `AI Recipe CLI — from an Instagram brand to three finished posts.

Usage:
  pnpm recipe <command> [options]

Commands:
  run            Run the pipeline (not implemented yet)
  help           Show this help

Options for "run":
  --brief <file>      Path to the brief YAML file
  --from-step <n>     Resume from stage n (1-${STAGES.length}): ${STAGES.map((s, i) => `${i + 1}=${s}`).join(', ')}
  --run-id <id>       Existing run id to resume
  -h, --help          Show this help
`;

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    brief: { type: 'string' },
    'from-step': { type: 'string' },
    'run-id': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

const command = positionals[0] ?? 'help';

if (values.help || command === 'help') {
  console.log(HELP);
} else if (command === 'run') {
  console.error('The "run" command is not implemented yet (milestone M0 skeleton).');
  process.exitCode = 1;
} else {
  console.error(`Unknown command: ${command}\n`);
  console.log(HELP);
  process.exitCode = 1;
}
