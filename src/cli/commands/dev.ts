import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, watch } from 'node:fs';
import { join } from 'node:path';
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { generateKeyPairSync, createSign, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';

export const devCommand = new Command('dev')
  .description('Start local development server')
  .option('--port <port>', 'Port for standalone dev server', '5173')
  .option('--platform', 'Serve IIFE bundle for use inside the platform iframe')
  .option('--bundle-port <port>', 'Port for the bundle server in --platform mode', '5174')
  .action(async (opts: { port: string; platform: boolean; bundlePort: string }) => {
    const cwd = process.cwd();
    const pkgPath = join(cwd, 'package.json');

    if (!existsSync(pkgPath)) {
      console.error(
        'No package.json found. Run this from a ThatOpen app project.',
      );
      process.exit(1);
    }

    if (opts.platform) {
      startPlatformMode(cwd, opts.bundlePort);
    } else {
      startStandaloneMode(cwd, opts.port);
    }
  });

function startStandaloneMode(cwd: string, port: string) {
  console.log(`Starting standalone dev server on http://localhost:${port}`);
  console.log('');
  console.log('Tip: To test inside the platform, run:');
  console.log('  thatopen dev --platform');
  console.log('');

  const vite = spawn('npx', ['vite', '--port', port], {
    cwd,
    stdio: 'inherit',
    shell: true,
  });

  vite.on('exit', (code) => process.exit(code ?? 0));
}

/**
 * Get or generate a self-signed certificate for localhost HTTPS.
 * Uses Node's built-in crypto module — no external tools needed.
 * Stored in ~/.thatopen/certs/ so it's generated once and reused.
 */
function getLocalCert(): { key: string; cert: string } {
  const certDir = join(homedir(), '.thatopen', 'certs');
  const keyPath = join(certDir, 'localhost-key.pem');
  const certPath = join(certDir, 'localhost-cert.pem');

  if (existsSync(keyPath) && existsSync(certPath)) {
    return {
      key: readFileSync(keyPath, 'utf-8'),
      cert: readFileSync(certPath, 'utf-8'),
    };
  }

  console.log('Generating self-signed certificate for localhost...');
  mkdirSync(certDir, { recursive: true });

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // Build a self-signed X.509 certificate using raw DER encoding
  const serialNumber = randomBytes(8);
  // Validity: now to +365 days
  const notBefore = new Date();
  const notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  function encodeLength(len: number): Buffer {
    if (len < 128) return Buffer.from([len]);
    if (len < 256) return Buffer.from([0x81, len]);
    return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
  }

  function encodeTLV(tag: number, value: Buffer): Buffer {
    return Buffer.concat([Buffer.from([tag]), encodeLength(value.length), value]);
  }

  function encodeOID(oid: string): Buffer {
    const parts = oid.split('.').map(Number);
    const bytes = [40 * parts[0] + parts[1]];
    for (let i = 2; i < parts.length; i++) {
      let v = parts[i];
      if (v >= 128) {
        const stack: number[] = [];
        stack.push(v & 0x7f);
        v >>= 7;
        while (v > 0) {
          stack.push((v & 0x7f) | 0x80);
          v >>= 7;
        }
        bytes.push(...stack.reverse());
      } else {
        bytes.push(v);
      }
    }
    return encodeTLV(0x06, Buffer.from(bytes));
  }

  function encodeUTF8String(s: string): Buffer {
    return encodeTLV(0x0c, Buffer.from(s, 'utf-8'));
  }

  function encodeInteger(buf: Buffer): Buffer {
    // Ensure positive by prepending 0x00 if high bit set
    if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0x00]), buf]);
    return encodeTLV(0x02, buf);
  }

  function encodeGeneralizedTime(date: Date): Buffer {
    const s = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
    return encodeTLV(0x18, Buffer.from(s, 'ascii'));
  }

  function encodeBitString(buf: Buffer): Buffer {
    return encodeTLV(0x03, Buffer.concat([Buffer.from([0x00]), buf]));
  }

  // Subject/Issuer: CN=localhost
  const cnOID = encodeOID('2.5.4.3'); // commonName
  const cnValue = encodeUTF8String('localhost');
  const cnSet = encodeTLV(0x31, encodeTLV(0x30, Buffer.concat([cnOID, cnValue])));
  const name = encodeTLV(0x30, cnSet);

  // Validity
  const validity = encodeTLV(0x30, Buffer.concat([
    encodeGeneralizedTime(notBefore),
    encodeGeneralizedTime(notAfter),
  ]));

  // SubjectAltName extension: DNS:localhost, IP:127.0.0.1
  const sanOID = encodeOID('2.5.29.17');
  const dnsName = encodeTLV(0x82, Buffer.from('localhost', 'ascii')); // context [2] = dNSName
  const ipAddr = encodeTLV(0x87, Buffer.from([127, 0, 0, 1])); // context [7] = iPAddress
  const sanValue = encodeTLV(0x30, Buffer.concat([dnsName, ipAddr]));
  const sanExtension = encodeTLV(0x30, Buffer.concat([sanOID, encodeTLV(0x04, sanValue)]));
  const extensions = encodeTLV(0xa3, encodeTLV(0x30, sanExtension));

  // TBS Certificate
  const version = encodeTLV(0xa0, encodeInteger(Buffer.from([0x02]))); // v3
  const serial = encodeInteger(serialNumber);
  const sigAlgo = encodeTLV(0x30, Buffer.concat([
    encodeOID('1.2.840.113549.1.1.11'), // sha256WithRSAEncryption
    encodeTLV(0x05, Buffer.alloc(0)),     // NULL
  ]));
  const subjectPublicKeyInfo = Buffer.from(publicKey as unknown as Buffer);

  const tbsCertificate = encodeTLV(0x30, Buffer.concat([
    version, serial, sigAlgo, name, validity, name, subjectPublicKeyInfo, extensions,
  ]));

  // Sign
  const signer = createSign('SHA256');
  signer.update(tbsCertificate);
  const signature = signer.sign(privateKey);

  // Full certificate
  const cert = encodeTLV(0x30, Buffer.concat([
    tbsCertificate,
    sigAlgo,
    encodeBitString(signature),
  ]));

  const certPem = '-----BEGIN CERTIFICATE-----\n' +
    cert.toString('base64').match(/.{1,64}/g)!.join('\n') +
    '\n-----END CERTIFICATE-----\n';

  writeFileSync(keyPath, privateKey);
  writeFileSync(certPath, certPem);

  console.log(`Certificate saved to ${certDir}`);
  console.log('');

  return { key: privateKey, cert: certPem };
}

function startPlatformMode(cwd: string, bundlePort: string) {
  const bundlePath = join(cwd, 'dist', 'bundle.js');
  const mapPath = join(cwd, 'dist', 'bundle.js.map');

  console.log('Building in watch mode...');
  console.log('');

  // Start vite build --watch
  const vite = spawn('npx', ['vite', 'build', '--watch'], {
    cwd,
    stdio: 'inherit',
    shell: true,
  });

  // SSE clients for live reload
  const sseClients: Set<ServerResponse> = new Set();

  // Watch bundle.js for changes and notify SSE clients
  let watchReady = false;
  const startWatching = () => {
    if (watchReady) return;
    const distDir = join(cwd, 'dist');
    if (!existsSync(distDir)) return;

    watchReady = true;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    watch(distDir, (_, filename) => {
      if (filename === 'bundle.js') {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          console.log('[reload] bundle.js changed, notifying clients...');
          for (const client of sseClients) {
            client.write('data: reload\n\n');
          }
        }, 200);
      }
    });
  };

  // Poll until dist/ exists, then start watching
  const watchInterval = setInterval(() => {
    if (existsSync(join(cwd, 'dist'))) {
      startWatching();
      clearInterval(watchInterval);
    }
  }, 500);

  // Request handler shared by both HTTP and HTTPS servers
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // SSE endpoint for live reload
    if (req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('data: connected\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // Bundle JS
    if (req.url === '/bundle.js' || req.url === '/') {
      if (!existsSync(bundlePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Bundle not built yet. Waiting for vite build...');
        return;
      }

      const content = readFileSync(bundlePath, 'utf-8');
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-store',
      });
      res.end(content);
      return;
    }

    // Source map
    if (req.url === '/bundle.js.map') {
      if (!existsSync(mapPath)) {
        res.writeHead(404);
        res.end('Source map not found');
        return;
      }

      const content = readFileSync(mapPath, 'utf-8');
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(content);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  };

  // Try HTTPS first, fall back to HTTP
  let tlsCert: { key: string; cert: string } | null = null;
  try {
    tlsCert = getLocalCert();
  } catch (err) {
    console.log('Could not generate HTTPS certificate (openssl not found?).');
    console.log('Falling back to HTTP. This works for local dev but may fail');
    console.log('if the platform is served over HTTPS (mixed content).');
    console.log('');
  }

  const protocol = tlsCert ? 'https' : 'http';
  const bundleUrl = `${protocol}://localhost:${bundlePort}/bundle.js`;

  const server = tlsCert
    ? createHttpsServer(tlsCert, handler)
    : createHttpServer(handler);

  server.listen(parseInt(bundlePort), () => {
    console.log(`Bundle server running at ${protocol}://localhost:${bundlePort}`);
    console.log('');
    console.log('Use this devUrl in the platform:');
    console.log(`  ${bundleUrl}`);
    console.log('');
    if (tlsCert) {
      console.log('The server uses a self-signed certificate. If the browser');
      console.log('blocks the request, open the URL above directly in a new tab');
      console.log('and accept the certificate, then reload the platform.');
      console.log('');
    }
    console.log('Live reload is enabled — save a file to rebuild and');
    console.log('the app will automatically reload inside the platform.');
    console.log('');
  });

  // Cleanup on exit
  process.on('SIGINT', () => {
    vite.kill();
    server.close();
    process.exit(0);
  });

  vite.on('exit', (code) => {
    server.close();
    process.exit(code ?? 0);
  });
}
