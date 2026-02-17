import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginCommand } from './commands/login';
import { createCommand } from './commands/create';
import { publishCommand } from './commands/publish';
import { devCommand } from './commands/dev';
import { runCommand } from './commands/run';

const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('thatopen')
  .description('CLI for ThatOpen Engine Services')
  .version(pkg.version);

program.addCommand(loginCommand);
program.addCommand(createCommand);
program.addCommand(publishCommand);
program.addCommand(devCommand);
program.addCommand(runCommand);

program.parse(process.argv);
