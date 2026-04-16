# Job Card Urgency Enhancement Design

**Goal:** Increase the visual prominence of "Overdue" and "Unpaid" (Owed) job cards to ensure they are immediately noticeable to the user, prompting action (marking as done/paid).

**Success Criteria:**
- "Overdue" jobs are shifted from the Orange palette to the Red palette.
- "Unpaid" (Owed) jobs receive a subtle, modern "highlight" effect (soft glow and gradient).
- The changes feel "on-trend" and cohesive with the existing Vanilla CSS design.
- Revertability is maintained via Git.

---

## Architecture & Design

### 1. Palette Alignment (Uniformity)
The "Overdue" status will be moved to the Red palette to align with the "Unpaid" urgency. 

- **Existing:** `.jr.overdue { border-left: 4px solid var(--orange); background: var(--orange-s); }`
- **Proposed:** `.jr.overdue { border-left: 5px solid var(--red); background: var(--red-s); }`

### 2. Enhanced Highlight for Unpaid (The "Pop")
To distinguish **Unpaid** (Owed) jobs from simply **Overdue** jobs, we will add elevation and depth.

- **Effect:** A soft outer glow (`box-shadow`) using the red theme color at low opacity.
- **Background:** A very subtle 135-degree linear gradient from the theme's soft red to pure white.
- **Border:** Increase the left accent border to `5px` for both states to increase vertical "weight".

### 3. Iconography (Syncing)
In `app.js`, the `jrHTML` function and other icon mappings should be updated to reflect the color shift.

- **Overdue Icon:** Change from `🟠` to `🔴` (or a similar red-alert style) to match the new CSS.

---

## Technical Specifications

### CSS Changes (`index.html`)

```css
/* Sync Overdue to Red Palette */
.jr.overdue {
  border-left: 5px solid var(--red); 
  background: var(--red-s);
}

/* Enhanced Unpaid Highlight */
.jr.owed {
  border-left: 5px solid var(--red);
  background: linear-gradient(135deg, var(--red-s) 0%, #fff 100%);
  box-shadow: 0 4px 12px rgba(217, 45, 32, 0.15); /* Soft Red Glow */
  position: relative;
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s;
}

/* Hover/Active State refinement for Unpaid */
.jr.owed:active {
  transform: scale(0.97);
  box-shadow: 0 2px 6px rgba(217, 45, 32, 0.1);
}
```

### JS Changes (`app.js`)

**`jrHTML` updates:**
```javascript
const icons = { 
  owed: '🔴', 
  sched: '🔵', 
  fu: '🔔', 
  review: '⭐', 
  overdue: '🔴', // Changed from 🟠
  unschd: '🗓️', 
  lead: '🟡' 
};
```

**`profJobRow` updates:**
Ensure the `tc` (type class) mapping for `overdue` and the iconography in the template string remain consistent with the new red-alert status.

---

## Reversion Plan
Since these changes are being committed to a Git repository, we can revert by running:
`git checkout sandbox -- index.html app.js`
(This will discard the uncommitted changes in the worktree).

---

## Self-Review
- **Internal Consistency:** The Red palette is used consistently for both urgent states.
- **Scope:** Purely CSS and minor JS string changes.
- **Ambiguity:** Explicitly defined the shadow and gradient values.
