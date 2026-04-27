# Code2Flow Scripts Plan

## Purpose

This document defines a lightweight script strategy so the project is easy to run, test, and iterate on during early development.

The main goal is to reduce command switching and support a smooth vibe-coding loop:

- start fast
- verify fast
- fix fast

## Recommended Repo Shape

When the codebase is scaffolded, use this layout:

```text
code2flow-agent/
├── backend/
├── frontend/
├── docs/
├── package.json
└── work.md
```

## Root-Level Scripts

The root `package.json` should act as the unified command entry.

### Recommended Scripts

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:frontend\" \"npm run dev:backend\"",
    "dev:frontend": "npm --prefix frontend run dev",
    "dev:backend": "npm --prefix backend run dev",
    "build": "npm run build:frontend && npm run build:backend",
    "build:frontend": "npm --prefix frontend run build",
    "build:backend": "npm --prefix backend run build",
    "lint": "npm run lint:frontend && npm run lint:backend",
    "lint:frontend": "npm --prefix frontend run lint",
    "lint:backend": "npm --prefix backend run lint",
    "test": "npm run test:frontend && npm run test:backend",
    "test:frontend": "npm --prefix frontend run test",
    "test:backend": "npm --prefix backend run test",
    "typecheck": "npm run typecheck:frontend && npm run typecheck:backend",
    "typecheck:frontend": "npm --prefix frontend run typecheck",
    "typecheck:backend": "npm --prefix backend run typecheck",
    "check": "npm run lint && npm run typecheck && npm run test"
  }
}
```

## Frontend Scripts

Recommended `frontend/package.json` scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "test": "vitest run",
    "typecheck": "vue-tsc --noEmit"
  }
}
```

## Backend Scripts

Recommended `backend/package.json` scripts:

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "lint": "eslint src --ext .ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

## Recommended Dev Dependencies

### Root

- `concurrently`

### Frontend

- `vite`
- `vue-tsc`
- `vitest`
- `eslint`
- `prettier`

### Backend

- `tsx`
- `typescript`
- `vitest`
- `eslint`
- `prettier`

## High-Frequency Workflow

### Daily Start

```bash
npm run dev
```

### Before Committing

```bash
npm run check
```

### When Debugging One Side Only

```bash
npm run dev:frontend
npm run dev:backend
```

## Recommended Next Setup Steps

1. Scaffold `frontend/` with Vue 3 + TypeScript + Vite
2. Scaffold `backend/` with Express + TypeScript
3. Add root `package.json`
4. Wire root scripts first
5. Add lint and typecheck before feature work expands
6. Add a minimal `check` pipeline before introducing agent complexity

## Team / AI Usage Notes

- Always prefer root-level commands when possible
- Keep script names conventional and boring
- Avoid custom command names that require memory
- If a task needs multiple steps, expose it as a single script once it becomes frequent
