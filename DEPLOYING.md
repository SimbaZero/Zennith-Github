# Deploying Zennith

How to push a change live. No prior knowledge assumed.

The live site is a **Cloudflare Worker** called `zennith-health-systems`:

> https://zennith-health-systems.simbarasheshmilygandi.workers.dev

> ## ⚠️ Read this first: two Cloudflare accounts
>
> The Cloudflare login used on this project can see **two** accounts. Only one
> of them has the site:
>
> | Account | ID | Has the site? |
> |---|---|---|
> | Simbarasheshmilygandi@gmail.com's Account | `2aa8ac7da701a9cd86aa8551b0fd800e` | **Yes. Always use this one.** |
> | Nkhumelenindae777@gmail.com's Account | `f7a51fa0bc67303e287794abd11b8286` | No |
>
> Deploying to the other one creates a second, empty copy of the site and
> leaves the real one unchanged. **Every command below sets
> `CLOUDFLARE_ACCOUNT_ID` for exactly this reason. Don't leave it out.**

---

## One-time setup (per computer)

1. Install [Bun](https://bun.sh) and Node.js.
2. Get the code and install it:
   ```bash
   git clone https://github.com/SimbaZero/Zennith-Github.git
   cd Zennith-Github
   bun install
   ```
3. Create a file called `.env` in the project folder with the `VITE_FIREBASE_…`
   values. **Ask the project owner for these**; they are not in the repo. Without
   them the build succeeds but the site cannot reach Firebase.
4. Sign in to Cloudflare:
   ```bash
   npx wrangler login
   ```
   - It prints a link. Open it, choose **Allow** and **Authorize**.
   - **You have 2 minutes.** If the page says "site can't be reached", the
     link expired. Run the command again and click through faster.
   - Tick both accounts on the first screen, then pick the right one with the
     `CLOUDFLARE_ACCOUNT_ID` below.

## Every deploy

Run these from the project folder, in order.

```bash
# 1. Check the code is healthy (should print nothing)
npx tsc --noEmit -p tsconfig.json

# 2. Build
bun run build

# 3. Note what is live right now (so you can roll back to it)
CLOUDFLARE_ACCOUNT_ID=2aa8ac7da701a9cd86aa8551b0fd800e npx wrangler deployments status --name zennith-health-systems

# 4. Deploy
CLOUDFLARE_ACCOUNT_ID=2aa8ac7da701a9cd86aa8551b0fd800e npx wrangler deploy
```

Write down the `Version(s)` number from step 3: it is your way back.

### Check it worked

Open the site on your phone and on a computer. Or from the terminal, each of
these should print `200`:

```bash
for p in / /login /signup; do
  curl -s -o /dev/null -w "$p %{http_code}\n" https://zennith-health-systems.simbarasheshmilygandi.workers.dev$p
done
```

## If it looks wrong: roll back

Use the version number you wrote down from step 3:

```bash
CLOUDFLARE_ACCOUNT_ID=2aa8ac7da701a9cd86aa8551b0fd800e npx wrangler rollback <VERSION-ID> --name zennith-health-systems
```

## Secrets (passwords and keys the server uses)

They are stored on Cloudflare, not in the code. List what is set (names only):

```bash
CLOUDFLARE_ACCOUNT_ID=2aa8ac7da701a9cd86aa8551b0fd800e npx wrangler secret list --name zennith-health-systems
```

Set or change one (it asks you to paste the value):

```bash
CLOUDFLARE_ACCOUNT_ID=2aa8ac7da701a9cd86aa8551b0fd800e npx wrangler secret put NAME --name zennith-health-systems
```

Delete one:

```bash
CLOUDFLARE_ACCOUNT_ID=2aa8ac7da701a9cd86aa8551b0fd800e npx wrangler secret delete NAME --name zennith-health-systems
```

Secrets the site uses: `FIREBASE_SERVICE_ACCOUNT`, `GEMINI_API_KEY`,
`SMSPORTAL_CLIENT_ID`, `SMSPORTAL_API_SECRET`, `SMSPORTAL_WEBHOOK_SECRET`,
`SMS_REMINDER_TRIGGER_SECRET`, `SMS_ONLY_TO`, optionally `RESEND_API_KEY`.

> **`DEMO_MODE`**: if this secret is set to `true`, the sign-in 2FA screen
> shows a "Skip (demo mode)" button for anyone who knows a password. Use it
> only for a presentation and **delete it afterwards**. Normal state: not set.

Wrangler won't change a secret until the latest code version is deployed, so if
you see "latest version isn't currently deployed", run the deploy first.

## What this guide does NOT cover

- **Firestore security rules.** They are deployed through Firebase, not
  Cloudflare, and need their own testing. See `docs/firestore-rules-proposed.rules`.
- **Seed or backfill scripts** (`scripts/`). They change live data; run each one
  with `--dry-run` first.

## No terminal? Use the dashboard

1. https://dash.cloudflare.com → switch to **Simbarasheshmilygandi@gmail.com's
   Account**.
2. **Workers & Pages → zennith-health-systems**.
3. **Deployments** shows every version and can roll one back; **Settings →
   Variables and Secrets** edits secrets.

Uploading new code still needs the terminal steps above.
