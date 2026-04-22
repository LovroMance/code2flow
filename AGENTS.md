# Code2Flow Agent Collaboration Guide

## Project Identity

- Project name: `Code2Flow`
- Goal: convert JavaScript, TypeScript, and Vue frontend code into Mermaid flowcharts with node-to-code-line mappings
- Primary stack:
  - Frontend: Vue 3, TypeScript, Vite, Monaco Editor, Mermaid.js, TailwindCSS
  - Backend: Node.js, Express, TypeScript, LangGraph, LangChain, Zod

## Product Direction

- Keep the overall scope defined in `docs/阶段一.md` and `docs/阶段二.md`
- Stage 1 is the first implementation target:
  - code input
  - Mermaid generation
  - node-to-line mapping
  - node click to editor highlight
  - SSE streaming
- Stage 2 adds:
  - follow-up Q&A
  - checkpointed conversation state
  - richer explanation output
  - stronger Vue-specific analysis

## Source Of Truth

- Product milestone planning: `docs/阶段一.md`, `docs/阶段二.md`
- Prompt and output contract: `docs/prompt-spec.md`
- Dev workflow and script conventions: `docs/scripts-plan.md`
- Current repo state and handoff: `docs/current-status.md`, `docs/session-handoff.md`

## Non-Negotiable Rules

- Use Vue-oriented examples, not React examples
- Do not introduce React-specific logic such as `useEffect` or `useState`
- Backend structured output must conform to the documented schema
- Mermaid output must be valid and renderable
- Node IDs must be stable enough to map chart nodes back to source line ranges
- Prefer simple, explicit implementations over clever abstractions

## Prompt Rules

- Prompts must target frontend code analysis for JavaScript, TypeScript, and Vue
- Prompt examples should use:
  - plain JavaScript control flow
  - async frontend logic
  - Vue `script setup` or Vue reactive patterns
- Prompt output must be strict JSON only
- Do not ask the model to reveal chain-of-thought in user-visible output

## Backend Implementation Rules

- Keep prompt templates centralized in `backend/src/prompts/code-flow.prompt.ts`
- Keep schemas and shared contracts centralized in `backend/src/domain/flow/schema.ts` and `backend/src/domain/flow/types.ts`
- Validate all model output with Zod before returning to the client
- Keep the first LangGraph flow minimal:
  - `analyze`
  - `validate`
  - conditional retry
- Return SSE events in a predictable event shape

## Frontend Implementation Rules

- Keep Monaco and Mermaid integration isolated in focused components
- Preserve a clean two-pane layout in the first version
- Clicking a Mermaid node must scroll and highlight the mapped editor lines
- Streaming UI should prioritize clarity over animation complexity
- Prefer composables for stateful frontend integration code
- Keep page orchestration in `pages/` and feature logic inside `features/`

## Current Implementation Snapshot

- Frontend already has:
  - workspace page
  - Monaco editor
  - Mermaid rendering
  - node mapping list
  - click-to-line highlight
  - `axios` for normal APIs
  - `fetch` for SSE
- Backend already has:
  - `GET /api/health`
  - `POST /api/generate-flow`
  - Zod request validation
  - SSE response writing
  - mock code-flow agent
- Current agent is still mock-based; do not assume LangChain is wired yet

## Working Style

- Build in small, testable vertical slices
- Prefer finishing one closed loop before opening the next
- Suggested order:
  1. backend schema and prompt contract
  2. flow generation API
  3. frontend editor shell
  4. Mermaid rendering
  5. click-to-line mapping
  6. streaming polish
  7. stage 2 conversation features

## Quality Bar

- TypeScript should stay strict where possible
- Add lightweight tests around:
  - schema validation
  - Mermaid validation
  - SSE payload shape
  - mapping behavior
- Avoid speculative architecture for stage 1
- If a feature belongs to stage 2, do not force it into stage 1
