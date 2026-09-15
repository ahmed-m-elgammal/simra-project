# Interactive Book Simulation App

Simulation layer on top of books: pick a persona → read → decide → live the consequences → recap what else could have happened. No runtime LLM, no chat, no quiz scoring. React Native + Expo client, Supabase backend, fully offline play from cached bundles.

Start with `AGENTS.md` (rules every session follows), then the specs below.

## Specs (source of truth — read before code)

| File | What it decides |
|---|---|
| `interactive_book_simulation_spec.md` | Original vision, core loop, non-goals |
| `db_and_client_architecture.md` | Graph shape, heterogeneity rule (data not schema) |
| `book_preparation_pipeline.md` | `bookforge` CLI: PDF in → canonical chapters out (agent-driven, no LLM API) |
| `prepare_algorithms.md` | Non-LLM algorithms + embeddings model lab |
| `db_performance_plan.md` | Postgres + prebuilt CDN bundles, gate + redirect |
| `bundle_builder.md` | Deterministic `compile()` → immutable versioned bundle |
| `api_service_layer.md` | Endpoints, webhook, backup, requests, devices, push |
| `ux_client_design.md` | Core-loop feel (sheet, outcome, recap) |
| `client_expo_ux_plan.md` | Expo build: engine, store, screens, edge states |
| `ui_screens_and_system.md` | Every screen + Quiet Editorial system (Stitch reference: “Simra — Book Catalog”) |
| `monetization_plan.md` | Free-first, one-time unlock on data, subscription only when earned |
| `clarification_decisions_addendum.md` | Locked forks (full bundle, DAG, push, full-path recap) |

## Build plans (task-by-task, in order)

`plan_01_builder.md` → `plan_02_cli.md` → `plan_03_api.md` → `plan_04_client.md`. Each ends with its own definition of done. No code outside a plan task.

## Code (flat top level — no `packages/`)

| Folder | What lives there |
|---|---|
| `builder/` | `@app/bundle-builder`: schemas, validators, `compile()` (Plan 01) |
| `cli/` | `bookforge` CLI: prompt/submit pairs, approve gates, publish (Plan 02) |
| `supabase/` | Migrations, seeds, Edge `api` + publish-hook (Plan 03) |
| `mobile/` | Expo app: engine, store, screens EN+AR (Plan 04) |

Hard boundary: authoring side (`builder/`, `cli/`, workdirs) never enters the mobile binary — only versioned CDN bundles do (`AGENTS.md` rule 9).

## Status

Planning complete, building now: Plan 01 Task 1 committed. Single rule for everyone: specs stay true or the change doesn't land.
