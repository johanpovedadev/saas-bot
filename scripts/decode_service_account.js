// Small utility to decode GOOGLE_SERVICE_ACCOUNT_B64 from bot-wasap/.env
// Writes decoded JSON to service_account_decoded.json and updates GOOGLE_APPLICATION_CREDENTIALS in .env

const fs = require('fs');
const path = require('path');

(async () => {
  try {
    const repoRoot = path.resolve(__dirname, '..');
    const envPath = path.join(repoRoot, 'bot-wasap', '.env');
    if (!fs.existsSync(envPath)) throw new Error('.env file not found at ' + envPath);

    const envRaw = fs.readFileSync(envPath, 'utf8');
    const match = envRaw.split(/\r?\n/).find(l => l.startsWith('GOOGLE_SERVICE_ACCOUNT_B64='));
    if (!match) throw new Error('GOOGLE_SERVICE_ACCOUNT_B64 not found in .env');

    const b64 = match.replace(/^GOOGLE_SERVICE_ACCOUNT_B64=/, '');
    if (!b64 || b64.trim().length === 0) throw new Error('GOOGLE_SERVICE_ACCOUNT_B64 is empty');

    // Decode base64 safely
    let buf;
    try {
      buf = Buffer.from(b64, 'base64');
    } catch (e) {
      throw new Error('Failed to decode base64: ' + e.message);
    }

    // Validate JSON
    let parsed;
    try {
      parsed = JSON.parse(buf.toString('utf8'));
    } catch (e) {
      throw new Error('Decoded content is not valid JSON: ' + e.message);
    }

    const outPath = path.join(repoRoot, 'service_account_decoded.json');
    fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2), { mode: 0o600 });

    // Update .env to set GOOGLE_APPLICATION_CREDENTIALS to the decoded file path (absolute)
    const absOutPath = outPath;
    let newEnv = envRaw;
    if (/^GOOGLE_APPLICATION_CREDENTIALS=/m.test(newEnv)) {
      newEnv = newEnv.replace(/^GOOGLE_APPLICATION_CREDENTIALS=.*$/m, `GOOGLE_APPLICATION_CREDENTIALS=${absOutPath}`);
    } else {
      newEnv = newEnv + '\nGOOGLE_APPLICATION_CREDENTIALS=' + absOutPath + '\n';
    }
    fs.writeFileSync(envPath, newEnv, 'utf8');

    console.log('SUCCESS: decoded service account written to', outPath);
    console.log('Updated bot-wasap/.env with GOOGLE_APPLICATION_CREDENTIALS path. Restart Django/bot to apply.');
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
})();