# Family Secret Santa — GitHub Pages edition

A static Vite/React website hosted by **GitHub Pages**. **Supabase** handles accounts, row-level security, wish lists, history, and the random drawing. **No Vercel account is required.**

## Start here: First-time setup

**1. Open GitHub.** **Create a NEW repository** named `family-secret-santa-pages` and set it to **Public**. With GitHub Free, Pages requires a public repository. **Do not turn the old private `family-secret-santa` repository public:** earlier commits may contain historical pairings and would become visible in its Git history. Keep the old repository private. Published website files are public regardless of repo visibility; **private data must stay in Supabase**.

**2. Upload the new static project.** Your new `family-secret-santa-pages` repository must contain the files in this `family-secret-santa-github-pages` directory directly at its root. Do not upload any old Next.js files. You can upload from GitHub's **Add file → Upload files** or use GitHub Desktop. The `.github/workflows/deploy.yml` file is essential. GitHub's browser uploader can reject some hidden directories; if `.github/workflows/deploy.yml` is missing after upload, create it using **Add file → Create new file**, enter the entire path `.github/workflows/deploy.yml`, and paste the contents from this package.

**IMPORTANT PRIVACY:** The ZIP also contains `PRIVATE_HISTORY_IMPORT.sql` **outside** the `github-pages-site` folder. DO NOT upload that private SQL file to a public GitHub repository; it exposes past private recipient assignments. Upload only the **contents** of `github-pages-site`.

**3. Set up Supabase.** At https://supabase.com/dashboard create a free Supabase project (or use your existing one).

- If **new database**, open Supabase → SQL Editor → New query, paste `supabase/schema.sql` from this repository and Run. Then open the private `PRIVATE_HISTORY_IMPORT.sql` on your own computer, paste it into a **second** Supabase SQL Editor query, and Run. This imports 18 historical pairings for 2022, 2024 and 2025; no drawing happened in 2023.
- If you **already ran the earlier Secret Santa schema**, **do not rerun** `supabase/schema.sql`. It already includes the historical records and database functions. Just reuse that Supabase project.
- In Supabase → Authentication → Providers → Email, enable email/password. Configure email verification/SMTP as needed.

**4. Add GitHub Actions variables.** In GitHub repository → **Settings → Secrets and variables → Actions → Variables → New repository variable** add both:

| Variable name | Value from Supabase |
|---|---|
| `VITE_SUPABASE_URL` | Supabase Project URL (`https://YOURID.supabase.co`) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable (`sb_publishable_...`) key |

Find both under Supabase **Connect** or Project Settings → API Keys. These values are deliberately client-visible, so **NEVER** use a secret key, `service_role`, database password, or JWT signing secret here. Row-level security keeps private data private.

**5. Enable GitHub Pages.** Repository → **Settings → Pages → Build and deployment → Source: GitHub Actions**. Then open **Actions** → **Deploy Family Secret Santa to GitHub Pages** → **Run workflow** (or commit an edit to `main`). The workflow installs dependencies, compiles the static site, and publishes it. When complete, visit **Settings → Pages** for the site URL:

`https://YOUR-GITHUB-USERNAME.github.io/family-secret-santa-pages/`

If your repository has a different name, the URL uses that name automatically.

**6. Set Supabase redirect URLs.** Supabase → Authentication → URL Configuration: set **Site URL** to your exact GitHub Pages URL (including trailing `/`) and add the same value to **Redirect URLs**. This is needed for email confirmations.

**7. Make yourself the organizer.** Visit the live site, sign up as `Sam` using your email, confirm your email, then run this **one-time SQL** in Supabase SQL Editor (replace the email):

```sql
update public.profiles
set is_admin = true, approved = true
where id = (select id from auth.users where email = 'YOUR_EMAIL_HERE');
```

Sign in and click Organizer. Have Joe, Dawn, Katie, Jordyn and Jonah create their accounts using those exact names. Approve each account in Organizer. **Do not approve unrecognized accounts.** Optionally disable further signups in Supabase Authentication settings once everyone has joined.

**8. Add permanent restrictions in Organizer** (spouses, etc.) as needed. Previous-year pairs are automatically blocked by the database drawing function. Then draw names. Do not redraw after people have looked unless you intend to reassign everyone.

## Rules

- Each approved person gets exactly one recipient who is also approved; no self-pairing.
- The draw blocks organizer-configured giver→recipient exclusions.
- The draw prevents repeat pairings **from the immediate previous calendar year**. The 2025 history is consulted for the 2026 draw; following years use saved drawing records. 2023 has no pairings.
- Secret assignments are protected by Supabase RLS; only the assigned giver reads their own current-year assignment and recipient list.
- Before and through **Thanksgiving 11:59 PM America/Denver** a participant can edit their full list. Beginning Friday 12:00 AM, the database permits **appending only** to the saved content until the following year's Thanksgiving cutoff cycle resets. The cutoff is enforced in Supabase SQL, not just by hiding buttons.
- Approved family members can see names of other approved family members; no one can see the historical table except the organizer.

## Future updates

Every commit to `main` triggers the GitHub Pages workflow. Supabase data persists independently of code deployments. If you later change the SQL schema, migrations must be applied **manually** in Supabase SQL Editor.

## Local development (optional)

```sh
npm install
cp .env.example .env.local
# Edit .env.local with your Supabase URL and publishable key
npm run dev
```

## Troubleshooting

- **Blank page or "Setup needed"**: check both repository Variables and rerun Actions workflow; variables are baked into the static build.
- **Page not found**: ensure Pages Source is GitHub Actions; wait for the deployment workflow to finish successfully. For repository names other than `family-secret-santa`, the workflow determines the base URL automatically.
- **Account created but no confirmation**: check Spam; verify Supabase Authentication email provider, Site URL, Redirect URLs and SMTP limits.
- **Cannot log in / permission denied**: ensure SQL schema was installed, your email was confirmed, and your profile approved by the organizer.
- **Drawing fails**: verify you have six approved people with unique historical names, and that restrictions don't make a valid perfect matching impossible.
- **Build fails**: open GitHub → Actions → the failed run → Build static site to inspect the real error. This version was prepared and checked for file structure, but a local build was not completed in the creation environment because the npm registry could not be reached.

## Security notes

- Public code is not secret. **Never commit private keys, passwords, or `PRIVATE_HISTORY_IMPORT.sql`.**
- Supabase's **publishable** key and Project URL are public by design. All private data is protected by the row-level policies in `schema.sql`. Review policies before production use.
- This is a small family project, not an externally audited production security system.
