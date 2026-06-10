# Dashboard Use Cases And Surface Budget

The dashboard accumulated many overlapping summary panels (assistants,
evidence panels, action summaries, command centers) that restate the same
facts in different prose. This document names the use cases each page serves
and budgets the surfaces allowed on each page's default lens. Anything that
does not directly serve the page's primary use case belongs in a secondary
lens (Activity / Diagnostics) or should be removed.

## Key Use Cases

- **UC1 — Health glance.** "Is my strategy healthy right now?" Answerable in
  under ten seconds from Overview Home without scrolling past one viewport.
- **UC2 — Performance read.** "How is it doing today / this month / all-time,
  and why?" Charts first; drill from a number to the trades or days behind it.
- **UC3 — Data confidence.** "What saved data do I have, and why is a symbol
  visible or missing?"
- **UC4 — Replay loop.** "Take saved data, build a draft, validate, replay,
  read the result."
- **UC5 — Incident response.** "Something is wrong — what, why, and what do I
  do?" Every alert explains itself and links to the page that fixes it.

## Surface Budget Per Default Lens

A default lens gets at most: one intro strip, one hero/primary surface, and
three supporting surfaces. Meta-panels that summarize other panels count
against the budget; two summaries of the same facts means one of them moves
or dies.

## Pass 1 (2026-06-10) — Overview Home

Kept: hero (equity + sparkline + status tiles), Performance Snapshot,
Current Alerts (promoted from Diagnostics — incidents belong on Home),
Open Positions. Moved to Activity: Today's Command Center, Today at a
Glance, Since Last Refresh. Moved to Diagnostics: Backend Pipeline,
Strategy Health Report, Start Here.

## Pass 2 (2026-06-10) — Disclosures And A Collapsible Guide

Introduced the `meta-disclosure` idiom: demoted summary panels collapse
behind a single native `<details>` row instead of stacking. Unlike a lens
move, the content stays on its page — one click away, closed by default.

- **Performance Home**: kept the home band and Current Scoreboard; Action
  Summary, Review, Evidence, Strategy Report, and Story now live in one
  collapsed disclosure between the scoreboard and the charts.
- **Workbench Home**: kept the Stage Summary, stepper, and example gallery;
  Simulation Plan, Readiness Review, Evidence, and Action Summary collapsed
  into one disclosure.
- **Page intro strips**: a Hide Guide / Show Guide toggle (persisted in
  localStorage) collapses the per-view guide cards, workflow rail, evidence
  chips, and recommended-next block, keeping route, title, status, and the
  two action buttons. New users see the full guide; daily users hide it once.

## Pass 3 Candidates

- **Data Home**: keep Saved Universe spotlight + Data Inventory; the
  remaining review/report/visibility panels overlap and belong in a
  disclosure or Diagnostics.
- **Runs / Fetch / Operations Homes**: same assistant/evidence/action-summary
  stacks; apply the disclosure idiom.
