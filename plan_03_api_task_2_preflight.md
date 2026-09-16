# Plan 03 Follow-up — API Contract and Long-Book Preflight

## Goal

Align the Plan 03 API fixtures and error contract, then remove ordering assumptions that can break books with many chapters or bundle versions before implementing Task 2.

The existing data-driven pipeline remains unchanged: segmentation defines the chapter sequence, assembly iterates that sequence, and the builder compiles every chapter. No book-specific branches or fixed chapter counts will be introduced.

## Governing files

- `AGENTS.md`
- `plan_03_api.md`
- `api_service_layer.md`
- `book_preparation_pipeline.md`
- `prepare_algorithms.md`
- `db_performance_plan.md`
- `bundle_builder.md`
- `client_expo_ux_plan.md`

## Changes

### 1. Reconcile the API contract

- Make `api_service_layer.md` use the Task 2/Plan 03 error envelope: `{ ok: false, error: { code, message } }`.
- Include `ABORTED` in the documented API error codes because the router maps unexpected failures to it.
- Update the Plan 03 seed description to describe the current multi-chapter fixture and explicitly state that fixture size is not a production limit.

### 2. Reconcile development fixtures

- Keep the current two-chapter, four-option minibook because it exercises chapter progression and is closer to the real multi-chapter path.
- Add the documented `u_fresh` scenario as an explicit zero-access verification in `scripts/verify-sql.mjs`; retain `u_caught` and `u_mid` for future push-cohort tests.
- Keep the fixture content generic and data-driven so API tests do not encode a chapter count.

### 3. Make chapter and bundle ordering numeric

- Sort approved chapter filenames by parsed numeric chapter order in `cli/src/lib/submit.ts`.
- Select the highest numeric bundle version in `cli/src/commands/publish.ts`, ignoring malformed version filenames.
- Preserve the existing assembly/compiler behavior that iterates all approved chapters from the locked segmentation sequence.

### 4. Add regression tests first

- Add a chapter-order test covering single-digit, double-digit, and triple-digit chapter filenames.
- Add a publish test proving `v10` is selected over `v9`.
- Add a long-book assembly/build regression using generated chapters beyond two digits, with no fixed chapter-count assertion.
- Update existing SQL verification expectations for the documented development users.

### 5. Verify

- Run the focused tests red before implementation and green after each vertical slice.
- Run `pnpm test`, `pnpm typecheck`, and `pnpm verify:sql`.
- Confirm no API implementation or client code is added in this preflight; Task 2 remains the next implementation slice.

## Definition of done

- API documentation and Plan 03 fixture instructions agree with the checked-in seed.
- Chapter ordering remains correct through at least chapter 100.
- Publish selects numeric versions correctly through at least version 10.
- The builder and CLI still process an arbitrary number of chapters using the segmentation data.
- All existing and new tests pass, typecheck passes, and SQL verification passes.
