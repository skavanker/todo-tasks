import { google } from 'googleapis';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { createServer } from 'node:http';
import { URL } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import open from 'open';

const CONFIG_DIR = join(homedir(), '.todo-tasks');
const CREDENTIALS_PATH = join(CONFIG_DIR, 'credentials.json');
const TOKEN_PATH = join(CONFIG_DIR, 'token.json');
const SCOPES = ['https://www.googleapis.com/auth/tasks'];
const REDIRECT_PORT = 3847;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

async function loadCredentials() {
  try {
    const content = await readFile(CREDENTIALS_PATH, 'utf-8');
    const { installed, web } = JSON.parse(content);
    return installed || web;
  } catch {
    throw new Error(
      `Could not find credentials.json in ${CONFIG_DIR}\n` +
      'Download it from Google Cloud Console and place it there.'
    );
  }
}

async function saveToken(token) {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(TOKEN_PATH, JSON.stringify(token, null, 2));
  await chmod(TOKEN_PATH, 0o600);
}

async function loadToken() {
  try {
    const content = await readFile(TOKEN_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Starts a local HTTP server to receive the OAuth2 callback.
 * Returns a promise that resolves with the authorization code.
 */
function waitForAuthCode(timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization failed</h1><p>You can close this window.</p>');
        clearTimeout(timeout);
        server.close();
        reject(new Error(`Authorization denied: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization successful!</h1><p>You can close this window.</p>');
        clearTimeout(timeout);
        server.close();
        resolve(code);
      }
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('Authorization timed out — no response after 2 minutes.'));
    }, timeoutMs);

    server.listen(REDIRECT_PORT, () => {});
    server.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Interactive auth flow — opens browser for consent, saves token.
 */
export async function authorize() {
  const creds = await loadCredentials();
  const oauth2 = new google.auth.OAuth2(creds.client_id, creds.client_secret, REDIRECT_URI);

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('Opening browser for Google authorization...');
  const codePromise = waitForAuthCode();

  try {
    await open(authUrl);
  } catch {
    console.log('Could not open browser automatically.');
    console.log('Open this URL manually:\n');
    console.log(authUrl);
  }

  const code = await codePromise;
  const { tokens } = await oauth2.getToken(code);
  await saveToken(tokens);
  console.log('Authorization successful! Token saved.');
}

/**
 * Returns an authenticated OAuth2 client.
 * Refreshes token automatically if expired.
 */
export async function getAuthClient() {
  const creds = await loadCredentials();
  const oauth2 = new google.auth.OAuth2(creds.client_id, creds.client_secret, REDIRECT_URI);

  const token = await loadToken();
  if (!token) {
    throw new Error('Not authenticated. Run "todo-tasks auth" first.');
  }

  oauth2.setCredentials(token);

  // Save refreshed token if it changes
  oauth2.on('tokens', async (newTokens) => {
    const current = await loadToken();
    await saveToken({ ...current, ...newTokens });
  });

  return oauth2;
}
