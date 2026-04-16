# Supermom UI Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Supermom CRM UI into a professional Apple/Material hybrid style with intuitive focus and edge-to-edge lists.

**Architecture:** Update CSS variables, base typography, and component classes in `index.html` to create a "Hybrid Focus" layout. Prominent items use elevated cards, while standard data uses edge-to-edge flush lists.

**Tech Stack:** Plain CSS (embedded in `index.html`).

---

### Task 1: Update CSS Variables & Global Resets

**Files:**
- Modify: `index.html` (Styles section)

- [ ] **Step 1: Update `:root` variables for Apple/Material aesthetic**

Update the `:root` block with softer borders, larger border-radii, and more subtle shadows.

- [ ] **Step 2: Update global styles for better typography and touch targets**

Adjust `html`, `body`, and base spacing to be more readable and "spacious."

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "style: update CSS variables and global resets for modernization"
```

---

### Task 2: Modernize Header & Navigation

**Files:**
- Modify: `index.html` (Header & Nav styles)

- [ ] **Step 1: Simplify Header and Navigation styles**

Transition to a white background header with subtle dividers and larger navigation icons.

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "style: modernize header and navigation UI"
```

---

### Task 3: Implement Hybrid Focus Cards & Lists

**Files:**
- Modify: `index.html` (Card, Job/Client row, and Up Next styles)

- [ ] **Step 1: Update Card and Job/Client row styles**

Switch from individual boxes to edge-to-edge flush lists for standard data, while keeping elevated cards for sections.

- [ ] **Step 2: Update "Up Next" Card to stand out**

Make the "Up Next" card a high-focus element with a unique background and extra rounding.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "style: implement hybrid focus with cards and edge-to-edge lists"
```

---

### Task 4: Modernize Buttons & Forms

**Files:**
- Modify: `index.html` (Button & Form styles)

- [ ] **Step 1: Update Buttons and Inputs for modern feel**

Transition to pill-shaped buttons and cleaner, subtle form inputs.

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "style: modernize buttons and form inputs"
```
