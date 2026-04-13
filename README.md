# Supermom CRM - Development Guide

## The Golden Rule
**Never work directly on the `main` branch.** 
- `main` is your **production** code. It should always be stable and deployable.
- `sandbox` is your **development** environment. All new features, bug fixes, and experiments happen here.

## The Daily Workflow
When you sit down to work on the project, follow this exact sequence:

1. **Start in Sandbox:**
   ```bash
   git checkout sandbox
   git pull origin sandbox
   ```
2. **Make Changes:** Write your code, update `CLAUDE.md`, and test locally in your browser.
3. **Save Your Work (Commit):**
   ```bash
   git add .
   git commit -m "feat: added new feature X"
   git push origin sandbox
   ```
4. **Push to Production (When Ready):**
   ```bash
   git checkout main
   git pull origin main
   git merge sandbox
   git push origin main
   ```
5. **Go Back to Sandbox:** Always return to the sandbox when done so you're ready for next time.
   ```bash
   git checkout sandbox
   ```

## Google Apps Script Deployment
We use `clasp` (Google's official CLI tool) to automatically push changes to `code.js`.

**First-Time Setup:**
1. Run `npm install` to install clasp.
2. Run `npm run login` to authenticate your Google Account.
3. Create a `.clasp.json` file with your Apps Script `scriptId` (e.g., `{"scriptId":"YOUR_SCRIPT_ID","rootDir":"."}`).

**Deploying a New Version:**
Once your code is tested and merged into `main`, simply run:
```bash
npm run deploy
```
This will push the latest `code.js` to Google and create a new version automatically.
