# Portal Backend Setup — Step-by-Step

This gets the password-protected Brothers Portal working **for real** (server-side auth, not the old client-side gate). Takes about 20 minutes end-to-end. You only need to do this once.

**What you'll need:**
- A web browser
- A free [Supabase](https://supabase.com) account (sign up with Google/GitHub)
- Terminal access (macOS: press `Cmd+Space`, type "Terminal")
- About 20 minutes

---

## Step 1 — Create the Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up.
2. Click **"New project"**.
3. Fill in:
   - **Name**: `deltasig-portal` (or anything you like)
   - **Database password**: Generate a strong one. **Save it somewhere safe** (1Password, etc.). You won't normally need it, but it's your last-resort recovery.
   - **Region**: **West US (North California)** — closest to Cal Poly.
4. Click **"Create new project"**. It takes ~2 minutes to provision.

---

## Step 2 — Run the database schema

Once the project is ready:

1. In the Supabase dashboard sidebar, click **SQL Editor**.
2. Click **"+ New query"**.
3. Open the file `supabase/migrations/001_init.sql` from this project — copy its ENTIRE contents — and paste into the SQL editor.
4. Click **"Run"** (or press `Cmd+Enter`).
5. You should see "Success. No rows returned" at the bottom.

This creates three tables (`portal_access`, `auth_attempts`, `portal_links`) and locks them so the browser can't read them directly.

---

## Step 3 — Grab your API credentials

1. In the Supabase sidebar: **Project Settings → API**.
2. You'll see three values. Save each temporarily:
   - **Project URL** — looks like `https://xxxxxxxxxx.supabase.co`
   - **anon public** key — a long string starting with `eyJ...`. **Safe to expose in the browser.**
   - **service_role** key — another long string starting with `eyJ...`. **SECRET. Never put this in the browser or commit it to git.**
3. Also generate a JWT secret by opening Terminal and running:
   ```bash
   openssl rand -base64 48
   ```
   Copy the output. This is your `JWT_SECRET`.

---

## Step 4 — Set the Edge Function environment variables

1. Supabase sidebar: **Project Settings → Edge Functions → Secrets**.
2. Click **"+ New secret"** and add these three (one at a time):
   - Name: `SUPABASE_URL` — Value: *your project URL from Step 3*
   - Name: `SUPABASE_SERVICE_ROLE_KEY` — Value: *the service_role key from Step 3*
   - Name: `JWT_SECRET` — Value: *the openssl output from Step 3*

The first two actually auto-populate in Supabase — you can skip them if they're already there. `JWT_SECRET` is the one you definitely need to add.

---

## Step 5 — Deploy the three Edge Functions

**The easy way (no terminal):**

1. Supabase sidebar: **Edge Functions**.
2. Click **"Create a new function"**.
3. Name it exactly: `verify-password`
4. Open `supabase/functions/verify-password/index.ts` in this project — copy the ENTIRE file contents — paste into the function editor.
5. Click **"Deploy function"**.
6. Repeat for:
   - `verify-session` — use `supabase/functions/verify-session/index.ts`
   - `get-portal-links` — use `supabase/functions/get-portal-links/index.ts`

**The terminal way (if you prefer):**
```bash
# Install Supabase CLI once
brew install supabase/tap/supabase

# Log in
supabase login

# Link this project
cd /Users/joshualinzay/calpolydeltasig
supabase link --project-ref YOUR_PROJECT_REF

# Deploy all three functions
supabase functions deploy verify-password
supabase functions deploy verify-session
supabase functions deploy get-portal-links
```

---

## Step 6 — Seed the portal password (local script)

This runs from your Mac, NOT from the website. It hashes a password and stores the hash in Supabase.

1. In Terminal:
   ```bash
   cd /Users/joshualinzay/calpolydeltasig
   cp .env.example .env
   ```
2. Open the new `.env` file in a text editor. Fill in:
   ```
   SUPABASE_URL=https://yourproject.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...your_service_role_key...
   JWT_SECRET=your_jwt_secret_from_step_3
   ```
3. Install the one tiny dependency (bcrypt):
   ```bash
   cd scripts && npm install && cd ..
   ```
4. Run the seed script:
   ```bash
   node scripts/seed-password.js
   ```
5. It'll ask for the portal password twice. Type it in, press Enter.
6. Output should say `✅ Password stored.`

**Changing the password later:** just re-run this script. Old sessions stay valid up to 24 hours.

---

## Step 7 — Update your portal links

The SQL migration seeded 6 placeholder links. Replace them with your real ones:

1. Supabase sidebar: **Table Editor → portal_links**.
2. Click the pencil on each row and update `label`, `url`, `description`.
3. Add new rows with the green `+` button as needed.

The links you'd previously hardcoded in `index.html` (Internal Communication, Alumni Book Database, Photo Album Submissions, Clothing Bank, Online Class Database, Professional Resources, Brother Cards, Standards Form, Study Abroad Resources) should all go here.

**Important**: once you move them into Supabase, ONLY brothers who log in can ever see these URLs. No more leaking via View Source.

---

## Step 8 — Wire the frontend to your project

In `index.html`, find the `PORTAL_CONFIG` block (near the bottom of the JS, around line ~4235) and update both values:

```js
const PORTAL_CONFIG = {
  supabaseFunctionsUrl: 'https://YOURPROJECT.supabase.co/functions/v1',
  supabaseAnonKey: 'eyJ...your_anon_public_key...',
};
```

**Important**: Use the **anon public** key here, NOT the service_role key. The anon key is designed to be public.

---

## Step 9 — Deploy to Netlify

```bash
cd /Users/joshualinzay/calpolydeltasig
npx -y netlify-cli deploy --prod --dir=. --no-build
```

Or just ask me to deploy.

---

## Step 10 — Test

1. Open `https://calpolydeltasig.netlify.app` in a private/incognito window.
2. Click **Portal** in the nav.
3. Enter the password. You should see the portal links.
4. Refresh the page. You should stay logged in (session persists 24h).
5. Open View Source (`Option+Cmd+U` on Mac). Search for one of your Google Drive URLs. **It shouldn't appear.** If it does, something's wrong — tell me.
6. Test rate limiting: type the wrong password 6 times fast. After 5 failures you should get "Too many attempts".
7. Wait 24 hours (or edit the JWT expiry in the function), refresh — you'll be asked to log in again.

---

## How things work (plain English)

- **Password check**: When someone types the portal password, the browser sends it to your `verify-password` Edge Function (a tiny server on Supabase). That server bcrypt-compares it against the stored hash. If correct, it gives back a signed token (JWT) that proves "this browser logged in successfully."
- **Link fetch**: The browser sends that token with a request to `get-portal-links`. The server verifies the token, then returns the list of links. If the token is missing or expired → no links returned, ever.
- **Persistence**: Token is saved in the browser's `localStorage` for 24 hours. On page reload, the browser checks if the token is still valid with `verify-session` — if yes, auto-unlock; if no, show password gate again.
- **Rate limiting**: Every attempt (success or fail) is logged with the IP. If an IP fails 5 times in 15 minutes, the 6th attempt is rejected without even checking the password.
- **Why this is secure**: The password hash is bcrypt (cost 12, designed to resist GPU attacks). The link URLs never exist in the HTML — they only exist in the Supabase database, and only the Edge Function (which has the service_role key) can read them. The JWT secret stays in Supabase server-side, so tokens can't be forged.

---

## Changing the password

1. Run `node scripts/seed-password.js` again with the new password. Done.
2. Existing sessions keep working up to 24 hours. Brothers will need to re-enter the new password after that (or after logging out).

## Removing a portal link

Supabase → Table Editor → portal_links → delete the row.

## Resetting everything

1. Supabase → Table Editor → clear the three tables.
2. Re-run the SQL from `001_init.sql` if needed.
3. Re-run the seed script.

---

## Troubleshooting

**"Incorrect password" when I type the right one**
- Did you deploy the Edge Functions? Check Supabase → Edge Functions → are all three listed?
- Did you set `JWT_SECRET` in Supabase Edge Function secrets? (Step 4)
- Did you run the seed script? (Step 6)

**"Network error"**
- Open browser DevTools → Console. What's the error message?
- Is your `PORTAL_CONFIG.supabaseFunctionsUrl` correct in index.html? It should end with `/functions/v1`.

**Project got paused by Supabase**
- Supabase free tier pauses projects after 7 days of inactivity. Dashboard → click **"Restore"**. This takes ~1 min. For a production chapter portal, consider a tiny cron to hit one of the functions weekly (can add later).

**I forgot the portal password**
- No problem. Just run `node scripts/seed-password.js` again and pick a new one.
