# Crypto Historical Data Fetching

The dedicated crypto fetcher is data-only. It never submits orders.

## Smoke Test

```bash
python3 live/fetch_crypto_history.py \
  --port 4002 \
  --symbols BTC-USD,ETH-USD \
  --bar-size 1min \
  --start 2026-05-21 \
  --end 2026-05-21 \
  --exchange ZEROHASH \
  --max-requests 2 \
  --force
```

## Three-Month 1-Minute Pull

Use the confirmed IBKR Zero Hash universe by default:

```bash
python3 live/fetch_crypto_history.py \
  --port 4002 \
  --bar-size 1min \
  --months 3 \
  --exchange ZEROHASH
```

Output goes to:

```text
cache/ibkr_crypto/ZEROHASH/1min/<SYMBOL>/<SYMBOL>_1min_AGGTRADES_<DAY>.parquet
```

Progress is appended to:

```text
cache/ibkr_crypto/fetch_manifest.csv
```

Dashboard-readable job summaries are written to:

```text
paper_logs/fetch_manifests/<JOB_ID>.json
```

The script writes one parquet per symbol/day. Re-running the same command resumes
by skipping existing chunks unless `--force` is passed.

By default, the script ends at yesterday's UTC date and fetches newest-to-oldest.
That avoids incomplete current-day chunks and lets newer listings stop after a
run of older no-data days. Use `--include-current-day` only when you explicitly
want the partial current UTC day.

## Probing For More Symbols

The broader generated universe is derived from Zero Hash PROD instruments. It
includes symbols that may not be supported by IBKR Zero Hash historical data. To
refresh it from the docs:

```bash
python3 scripts/build_zerohash_crypto_universe.py
```

Then qualify the generated probe symbols against the active Gateway/account:

```bash
python3 live/fetch_crypto_history.py \
  --port 4002 \
  --client-id 299 \
  --symbols-file config/crypto_universe_zerohash_prod_instruments.yaml \
  --exchange ZEROHASH \
  --qualify-only \
  --qualified-symbols-out config/crypto_universe_zerohash.yaml
```

The broader hand-maintained seed list can still be used for ad hoc probes:

```bash
python3 live/fetch_crypto_history.py \
  --port 4002 \
  --symbols-file config/crypto_universe_seed.yaml \
  --bar-size 1min \
  --start 2026-05-21 \
  --end 2026-05-21 \
  --exchange ZEROHASH \
  --max-requests 1
```

Confirmed symbols are written into `config/crypto_universe_zerohash.yaml`.

## Notes

- Use `ZEROHASH`, not `PAXOS`, for this account's crypto entitlement.
- Use `AGGTRADES` for crypto historical bars.
- IBKR may qualify a crypto contract but still return sparse or recent-only
  history for that symbol. `162 / HMDS query returned no data` is treated as an
  empty day, recorded in both manifests, and skipped on resume.
- IBKR pacing is the main speed limit. The script avoids large in-memory loads
  and avoids repeated unsupported-symbol probes by defaulting to the confirmed
  universe.
