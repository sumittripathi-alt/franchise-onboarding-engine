# Submission checklist

The link to give judges: **https://onboarding-engine-dun.vercel.app** (no login). It must keep working until **28 Oct 2026, end of day IST**.

## Before you freeze
- [ ] **Uptime monitor** (guardrail G7.5, the one manual item). In UptimeRobot (free), add an HTTP(s) monitor on `https://onboarding-engine-dun.vercel.app/api/health`, every 5 minutes, alert to your email. A healthy answer is `{"ok":true,"geminiConfigured":true,"dbConfigured":true,"dbReachable":true}`.
- [ ] **Spend cap on the AI key.** In Google AI Studio, set a spend cap or quota alert on the Gemini key. The app's own rate limit is per server instance, so this is the real backstop.
- [ ] **The Gemini key.** It was pasted into a chat during the build. You chose to keep it. If you change your mind: create a new key, then update `GEMINI_API_KEY` in Vercel (Settings, Environment Variables, Production) and in `.env.local`, then run `npx vercel deploy --prod`.
- [ ] **Supabase stays awake.** Free projects pause after about a week without use. Opening the app (or the uptime monitor) counts as use. Check the project shows as active in the Supabase dashboard on 27 Oct.
- [ ] **Empty the demo data if you want a clean list.** Anyone who opens the site sees the 20 most recent workspace names. To clear them: Supabase dashboard, SQL editor, `delete from public.workspaces;` (this deletes every workspace and its events; it cannot be undone).

## Freeze
1. Check the live site once yourself: upload the sample, open a decision, ask a question, change a fact, open the Map, export.
2. Make `main` and `release` the same commit: `git push origin main:release` (Vercel's production branch is `release`, but the live link only changes when you deploy by hand: `npx vercel deploy --prod`).
3. After that, don't push to `release` and don't deploy again unless something is broken.
4. Optional: in GitHub, turn on branch protection for `main` and `release` (Settings, Branches). Private repos need a paid plan for this.

## If something goes wrong on the day
- **The site is down or errors:** open https://vercel.com/sumit-753a/onboarding-engine/deployments, find the last deployment marked Ready, and choose Promote to Production (instant rollback).
- **The AI is slow or unavailable:** nothing to do. Decisions come from the rules; the app shows a banner and the "Retry AI reading" button, and chat answers common questions without the AI.
- **Shared workspaces don't save:** the page says "Not syncing. Changes are saved on this device only". Check `/api/health` for `dbReachable`, and the Supabase dashboard.
- **Check the whole thing again:** `npx playwright test` runs the browser tests against production (they leave test workspaces in the database; delete them afterwards, names `sampleWorkbook.xlsx` and `html.xlsx`).
