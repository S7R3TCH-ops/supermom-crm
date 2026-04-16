# Supermom Project Consolidation Design

## Overview
Consolidate two separate local Git repositories (`supermom-crm` and `supermom-sandbox`) into a single, professionally structured repository with branching (`main` and `sandbox`). The single repository will be hosted on the existing `supermom-crm` GitHub remote.

## Architecture & Structure
- **Unified Repository:** A new directory `supermom` will act as the single local repository.
- **Branching Strategy:**
  - `main`: The production-ready code (migrated from `supermom-crm` `main` branch).
  - `sandbox`: The development environment code (migrated from `supermom-sandbox` `main` branch).
- **History Preservation:** Both repository histories will be merged using git remotes so no commit history is lost.
- **GitHub Integration:** The existing `supermom-crm` GitHub repository will be configured as the `origin` remote. The new `sandbox` branch will be pushed alongside `main`.

## Migration Steps
1. Create a new `supermom` directory and initialize an empty Git repository.
2. Add the local `supermom-crm` folder as a remote and fetch its `main` branch.
3. Add the local `supermom-sandbox` folder as a remote and fetch its `main` branch.
4. Checkout the fetched `supermom-crm` branch locally as `main`.
5. Checkout the fetched `supermom-sandbox` branch locally as `sandbox`.
6. Add the existing GitHub remote (`https://github.com/S7R3TCH-ops/supermom-crm`) as `origin`.
7. Push `sandbox` to GitHub (and ensure `main` is up to date).

## Cleanup
Once the GitHub repository is verified and both branches are visible online, the legacy `supermom-crm` and `supermom-sandbox` local folders, as well as the obsolete `supermom-crm-test` GitHub repository, can be archived or deleted by the user.