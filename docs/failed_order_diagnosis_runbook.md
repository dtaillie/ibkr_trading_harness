# Failed Order Diagnosis Runbook

Use this checklist when an order is rejected, canceled, not filled, or missing
from expected paper-trading artifacts.

## Locate The Event

1. Open dashboard Runs.
2. Inspect recent orders, fills, rejects, and logs.
3. Open Performance to see whether account snapshots changed.
4. Check Operations for stale runner/Gateway status.
5. Inspect the raw run directory only if the dashboard summary is insufficient.

Summarize a run directory:

```bash
python3 scripts/summarize_plugin_run.py paper_logs/example_plugin_runner
```

## Classify The Failure

- Runner rejection: config guard blocked the intent before broker submission.
- Broker rejection: IBKR accepted the API request but rejected/canceled the
  order.
- Missing fill: order is still working, expired, canceled, or submitted outside
  the expected market/session.
- Missing telemetry: order may have happened, but artifacts or publisher state
  are stale.

## Common Runner Rejections

- symbol not in `execution.allowed_symbols`
- side not in `execution.allowed_sides`
- order type not in `execution.allowed_order_types`
- missing current price
- max orders reached
- quantity, cash quantity, notional, or exposure cap exceeded
- short sale attempted while shorts are disabled
- short sale attempted outside `execution.shortable_symbols`
- short sale exceeded per-symbol or total short-notional caps
- stale data or missing bar context

Run static validation:

```bash
python3 live/plugin_runner.py \
  --config config/plugin_runner.example.yaml \
  --validate-only
```

## Common Broker Rejections

- wrong account mode or port
- market-data permission or contract issue
- unsupported order type, time in force, or quantity style for the venue
- crypto order requiring cash quantity
- insufficient buying power
- market closed or instrument not tradable at that time
- duplicate client ID or disconnected API session

## Evidence To Capture

Keep this evidence locally, not in the public repo:

- timestamp
- mode (`shadow`, `simulated-paper`, `paper`, or `live`)
- config file path, without secrets
- symbol, side, order type, quantity/cash quantity
- broker error code/message
- relevant decision/order/fill/reject artifact rows
- Gateway log excerpt
- whether the dashboard status was fresh

## Recovery

1. Pause or stop the runner if duplicate orders are possible.
2. Confirm actual broker paper positions.
3. Fix config/permissions/order construction.
4. Run `--validate-only`.
5. Restart Gateway only if API/session state is suspect.
6. Restart the runner and watch the next order lifecycle end to end.
