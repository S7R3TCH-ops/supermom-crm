# Handoff Report — April 16, 2026

## Overview
Successfully implemented Admin orphan key fixes, exposed hourly rate overrides in job modals, and enhanced the UI urgency for job cards. The application has been bumped to **v4.07 (Frontend)** and **v5.02 (Backend)**.

---

## 1. Functional Fixes & Features

### Admin Orphan Key Sync
- **`saveListItem` (app.js):** Now detects if a service name is being renamed. If so, it updates the corresponding key in `S.biz.service_prices` and calls `saveBizConfig()` to ensure the backend stays in sync.
- **`delListItem` (app.js):** Now explicitly deletes the associated service price from `S.biz.service_prices` when a service is removed, preventing "ghost" keys in the config.

### Hourly Rate Overrides
- **`getJobTotals` (app.js):** Updated to accept a `rate` property in its override object (`ov`). It now checks for this override before falling back to the job's stored rate or the global business rate.
- **Job Modals:** 
    - Both `openJobModal` (Scheduled) and `openJobModalEdit` (Completed) now expose an **Hourly Rate ($)** input field (`#je-rate`).
    - The calculation preview (`#je-calc-preview`) is now permanently un-hidden and provides live updates as the user types in the rate or hours.
- **`submitJobEdit`:** Now correctly pulls the value from `#je-rate` and saves it to the job object as `Hourly_Rate`.

---

## 2. UI/UX Enhancements (Job Card Urgency)

### Modernized Styles
- Applied a unified "Soft UI" aesthetic to all job cards (`.jr` class) featuring:
    - Rounded corners (`var(--r)`).
    - Transition effects on transform/shadow.
    - Subtle 135-degree gradients to white.

### "Alert Mode" for Urgent Tasks
- **Overdue (Orange) & Unpaid (Red)** cards now use "Alert Mode":
    - **Thick Accents:** 8px left border.
    - **Full Framing:** 1px solid border all around.
    - **Vibrant Backgrounds:** Solid tinted backgrounds (not fading to white).
    - **Glow Effect:** Heavy `box-shadow` (glow) using the respective theme colors at 0.25 opacity.
    - **Urgent Icons:** Icons changed from `🟠/🔴` to `🚨` for maximum visibility.
- **Buttons:** Per user request, action buttons on urgent cards remain Blue (`b-bl`) rather than matching the card color.

### Dynamic Hourly Rate Button
- **`updHourlyBtnText` (app.js):** New helper function that updates the text of the "Hourly" price button (`#pr-h`) to show the specific rate for the selected service (or the global rate if no custom rate exists).
- **Integration:** Called from `onSvcChange`, `loadBizConfig`, and `resetBookForm` to ensure the UI always reflects the actual rate that will be used for calculation.

---

## 3. Deployment & Versions

- **`app.js`**: Bumped to **v4.07**.
- **`index.html`**: Bumped to **v4.07** (synced with app.js).
- **`code.js`**: Bumped to **v5.02** (version sync with frontend changes).
- **`CLAUDE.md`**: Updated to reflect current source-of-truth versions.

### Git State
- Changes are committed on the `sandbox` branch.
- Deployment to GitHub Pages was performed by checking out `index.html`, `app.js`, `code.js`, and `CLAUDE.md` onto the `main` branch and pushing to `origin main`.

---

## Next Steps / Notes
- The "Alert Mode" is quite high-contrast. If the user finds it too loud, the backgrounds in `index.html` can be shifted back toward gradients.
- Ensure the `code.js` (v5.02) is actually deployed to the Google Apps Script environment via the GAS editor or `clasp push` if applicable.
