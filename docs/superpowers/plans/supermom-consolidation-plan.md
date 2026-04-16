# Supermom Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Combine `supermom-crm` and `supermom-sandbox` into a single `supermom` repository with `main` and `sandbox` branches synced to the existing GitHub origin.

**Architecture:** A unified Git repository preserving commit history from both source repositories via local remotes.

**Tech Stack:** Git

---

### Task 1: Initialize New Repository

**Files:**
- Create: `C:\Users\jlund\Documents\Projects\supermom` (directory)

- [ ] **Step 1: Create and initialize new repository**

```powershell
New-Item -ItemType Directory -Force -Path "C:\Users\jlund\Documents\Projects\supermom"
cd "C:\Users\jlund\Documents\Projects\supermom"
git init
```
Expected: Initialized empty Git repository in the new supermom folder.

### Task 2: Migrate CRM as Main Branch

- [ ] **Step 1: Add CRM as remote**

```powershell
cd "C:\Users\jlund\Documents\Projects\supermom"
git remote add legacy-crm ../supermom-crm
```

- [ ] **Step 2: Fetch CRM main branch**

```powershell
cd "C:\Users\jlund\Documents\Projects\supermom"
git fetch legacy-crm main
```

- [ ] **Step 3: Checkout and set up main**

```powershell
cd "C:\Users\jlund\Documents\Projects\supermom"
git checkout -b main FETCH_HEAD
```
Expected: Switched to a new branch 'main' containing the CRM files and commit history.

### Task 3: Migrate Sandbox as Sandbox Branch

- [ ] **Step 1: Add Sandbox as remote**

```powershell
cd "C:\Users\jlund\Documents\Projects\supermom"
git remote add legacy-sandbox ../supermom-sandbox
```

- [ ] **Step 2: Fetch Sandbox main branch**

```powershell
cd "C:\Users\jlund\Documents\Projects\supermom"
git fetch legacy-sandbox main
```

- [ ] **Step 3: Checkout and set up sandbox branch**

```powershell
cd "C:\Users\jlund\Documents\Projects\supermom"
git checkout -b sandbox FETCH_HEAD
```
Expected: Switched to a new branch 'sandbox' containing the Sandbox files and commit history.

### Task 4: Setup GitHub Remote and Push

- [ ] **Step 1: Add existing GitHub origin**

```powershell
cd "C:\Users\jlund\Documents\Projects\supermom"
git remote add origin https://github.com/S7R3TCH-ops/supermom-crm
```

- [ ] **Step 2: Push main branch**

```powershell
cd "C:\Users\jlund\Documents\Projects\supermom"
git checkout main
git push -u origin main
```
Expected: `main` is pushed to GitHub and configured to track `origin/main`.

- [ ] **Step 3: Push sandbox branch**

```powershell
cd "C:\Users\jlund\Documents\Projects\supermom"
git checkout sandbox
git push -u origin sandbox
```
Expected: `sandbox` is pushed to GitHub and configured to track `origin/sandbox`.

### Task 5: Clean Up Local Remotes

- [ ] **Step 1: Remove temporary legacy remotes**

```powershell
cd "C:\Users\jlund\Documents\Projects\supermom"
git remote remove legacy-crm
git remote remove legacy-sandbox
```
Expected: Local remotes are cleaned up, leaving only `origin`.
