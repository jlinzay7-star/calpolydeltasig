#!/usr/bin/env node
// scripts/seed-password.js
// Run LOCALLY only. Hashes the portal password and upserts it into Supabase.
//
// Usage:
//   1. Create a file called .env at the project root with:
//        SUPABASE_URL=https://xxxxx.supabase.co
//        SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
//   2. From the project root, run:
//        cd scripts && npm install && cd ..
//        node scripts/seed-password.js
//   3. You'll be prompted for the portal password. Type it in (it will be hidden).
//   4. The script hashes it with bcrypt (cost 12) and stores the hash in Supabase.
//   5. The plaintext password is NEVER logged, saved, or sent anywhere else.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ---- Load .env from project root ----
const envPath = path.resolve(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.error('❌ No .env file found at', envPath);
  console.error('   Copy .env.example to .env and fill in your Supabase credentials first.');
  process.exit(1);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('#'))
    .map(l => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

// ---- Ensure deps available ----
let bcrypt;
try {
  bcrypt = require('bcryptjs');
} catch {
  console.error('❌ bcryptjs not installed. Run: cd scripts && npm install');
  process.exit(1);
}

// ---- Prompt for password (hidden input) ----
function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // Hide input
    const stdin = process.openStdin();
    process.stdin.on('data', () => {});
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
    rl._writeToOutput = (c) => rl.output.write('*');
  });
}

(async () => {
  console.log('\n🔐  DSP Kappa Mu — Portal Password Seed\n');

  // Simple prompt (plaintext visible) to avoid readline-stealth complexity
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const pw1 = await new Promise(r => rl.question('Enter portal password: ', r));
  const pw2 = await new Promise(r => rl.question('Confirm password:       ', r));
  rl.close();

  if (pw1 !== pw2) { console.error('\n❌ Passwords do not match.'); process.exit(1); }
  // Minimum length is intentionally low — the chapter shares one short password.
  // Real security is rate-limit (5 attempts / IP / 15 min) + bcrypt cost 12, not length.
  if (pw1.length < 4) { console.error('\n❌ Use at least 4 characters.'); process.exit(1); }

  const hash = await bcrypt.hash(pw1, 12);

  // Upsert: delete all rows, insert new
  const clearRes = await fetch(`${SUPABASE_URL}/rest/v1/portal_access?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: 'DELETE',
    headers: {
      'apikey': SERVICE_ROLE,
      'Authorization': `Bearer ${SERVICE_ROLE}`,
      'Prefer': 'return=minimal',
    },
  });
  if (!clearRes.ok && clearRes.status !== 404) {
    console.error('\n❌ Failed to clear existing rows:', clearRes.status, await clearRes.text());
    process.exit(1);
  }

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/portal_access`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_ROLE,
      'Authorization': `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ password_hash: hash, updated_at: new Date().toISOString() }),
  });

  if (!insertRes.ok) {
    console.error('\n❌ Insert failed:', insertRes.status, await insertRes.text());
    process.exit(1);
  }

  console.log('\n✅  Password stored. Brothers can now log in to the portal.');
  console.log('    Hash length:', hash.length, 'chars  (bcrypt cost 12)\n');
})();
