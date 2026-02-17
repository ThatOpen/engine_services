import { Command } from 'commander';
import { writeConfig, updateLocalConfig } from '../lib/config';
import { EngineServicesClient } from '../../core/client';

export const loginCommand = new Command('login')
  .description('Authenticate with the ThatOpen platform')
  .option('--token <token>', 'Access token from the dashboard')
  .option(
    '--api-url <url>',
    'API URL',
    'https://dev.api.thatopen.com',
  )
  .option(
    '--local',
    'Save credentials to local .thatopen file instead of global config',
  )
  .action(async (opts: { token?: string; apiUrl: string; local?: boolean }) => {
    if (!opts.token) {
      console.log('');
      console.log('  To log in, you need an access token from the ThatOpen platform.');
      console.log('');
      console.log('  1. Go to your ThatOpen dashboard');
      console.log('  2. Navigate to Settings > API Tokens');
      console.log('  3. Create a new token and copy it');
      console.log('');
      console.log('  Then run:');
      if (opts.local) {
        console.log('    npm run login -- --token <your-token>');
      } else {
        console.log('    thatopen login --token <your-token>');
      }
      console.log('');
      process.exit(1);
    }

    const apiUrl = opts.apiUrl.replace(/\/$/, '');

    console.log('Validating token...');

    try {
      const client = new EngineServicesClient(opts.token, apiUrl);
      await client.listApps();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Token validation failed: ${msg}`);
      console.error('Check your token and API URL.');
      process.exit(1);
    }

    if (opts.local) {
      updateLocalConfig({ accessToken: opts.token, apiUrl });
      console.log('Logged in successfully. Config saved to .thatopen');
    } else {
      writeConfig({ accessToken: opts.token, apiUrl });
      console.log(
        'Logged in successfully. Config saved to ~/.thatopen/config.json',
      );
    }
  });
