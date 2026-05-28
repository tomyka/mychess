# Guest/Anonymous Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to access and use all KidChess features without creating an account, using Supabase anonymous auth for seamless persistence, with a visible "Save your progress — Sign up!" banner and frictionless upgrade path.

**Architecture:** Every visitor receives an anonymous Supabase session automatically (via `signInAnonymously()` in the server hook). Anonymous users get an auto-created guest profile and can use all kid features. A sticky banner prompts sign-up. Signing up converts the anonymous account in-place via `updateUser()`, preserving all repertoires and stats.

**Tech Stack:** SvelteKit, Supabase Auth (anonymous sign-ins), TypeScript

---

### Task 1: Auto anonymous session in hooks.server.ts

**Files:**
- Modify: `kidchess/src/hooks.server.ts`

- [ ] Update `safeGetSession` to auto-create an anonymous session when none exists, and auto-create a guest profile for new anonymous users.

### Task 2: Remove hard redirect from (kid) layout

**Files:**
- Modify: `kidchess/src/routes/(kid)/+layout.server.ts`

- [ ] Allow anonymous users through. Pass `isGuest` flag to layout.

### Task 3: Block anonymous users from coach routes

**Files:**
- Modify: `kidchess/src/routes/(coach)/+layout.server.ts`

- [ ] Redirect anonymous users (is_anonymous) to /login.

### Task 4: Add "Save your progress" guest banner

**Files:**
- Modify: `kidchess/src/routes/(kid)/+layout.svelte` (create if not exists)

- [ ] Show sticky banner for guest users linking to /login?signup=1.

### Task 5: Login page handles anonymous → real account conversion

**Files:**
- Modify: `kidchess/src/routes/login/+page.svelte`

- [ ] On sign-up, if user is currently anonymous, call `updateUser()` to convert. Show "Save your progress" message.

