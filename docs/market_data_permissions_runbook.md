# Market Data Permissions Runbook

IBKR historical and live data failures are often permission or venue problems,
even when Gateway login and API connectivity are healthy.

## First Checks

1. Confirm Gateway/TWS is connected.
2. Confirm the correct account mode and port.
3. Confirm the instrument's exchange/venue in the contract.
4. Confirm account trading permissions separately from market-data permissions.
5. Try a tiny request for one liquid symbol before a broad universe pull.

Stock example:

```bash
python3 live/fetch_history.py \
  --host 127.0.0.1 \
  --port 4002 \
  --client-id 99 \
  --symbols SPY \
  --bar-size 5min \
  --duration "1 D" \
  --rth
```

Crypto Zero Hash example:

```bash
python3 live/fetch_crypto_history.py \
  --host 127.0.0.1 \
  --port 4002 \
  --client-id 199 \
  --symbols BTC-USD \
  --exchange ZEROHASH \
  --bar-size 1min \
  --months 1
```

## Diagnose By Error Shape

- `No market data permissions`: the account does not have the required data
  subscription or acknowledgement for that venue/data type.
- `HMDS query returned no data`: the contract qualified, but that venue/time
  range/bar type produced no bars. Try a shorter range, different bar size, or
  a more liquid symbol.
- Contract qualification failure: symbol, currency, exchange, or security type
  is wrong or unsupported by the account.
- Pacing/throttle warnings: the request pattern is too aggressive; use smaller
  chunks, pause between requests, or resume from the manifest later.

## Crypto Notes

IBKR crypto data can depend on venue naming. For Zero Hash, use
`--exchange ZEROHASH` and symbols like `BTC-USD`. Trading permission, crypto
product approval, and historical market-data permission can still be separate
checks.

If a broad crypto fetch has many no-data chunks, inspect the manifest in the
dashboard Fetch Jobs page. One unsupported symbol should not invalidate the
whole run.

Resume a crypto fetch from its manifest:

```bash
python3 live/fetch_crypto_history.py \
  --resume-manifest paper_logs/fetch_manifests/example_manifest.json
```

## Dashboard Workflow

1. Open Fetch Jobs.
2. Select the failed manifest.
3. Inspect failed symbols, no-data chunks, retry/pacing events, and outputs.
4. Use Copy Resume Command when the manifest is resumable.
5. Add output roots to `dashboard.data_roots` if produced files are not visible
   in Data Library.

## Escalation Packet

When asking IBKR support about a permission issue, include:

- account mode, but not account ID in public notes
- symbol
- security type
- exchange/venue
- currency
- bar size and duration
- data type when relevant
- exact error code/message
- whether the same contract displays in Trader Workstation or Client Portal

