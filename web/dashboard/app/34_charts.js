function rangeLabel(start, end) {
  if (!start && !end) return "n/a";
  return `${text(start)} -> ${text(end)}`;
}

function timezoneLabel(mode) {
  if (mode === "local") return "Local";
  if (mode === "eastern") return "Eastern";
  return "UTC";
}

function formatTimestampForMode(value, mode = "utc") {
  const millis = timestampMillis(value);
  if (millis === null) return text(value);
  const options = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  };
  if (mode === "utc") options.timeZone = "UTC";
  if (mode === "eastern") options.timeZone = "America/New_York";
  return new Intl.DateTimeFormat("en-US", options).format(new Date(millis));
}

function timeRangeLabel(start, end, mode = "utc") {
  if (!start && !end) return "n/a";
  return `${formatTimestampForMode(start, mode)} -> ${formatTimestampForMode(end, mode)}`;
}

function miniChart(points) {
  if (!points || points.length < 2) return `<span class="muted">n/a</span>`;
  const closes = points.map((point) => Number(point.close)).filter((value) => Number.isFinite(value));
  if (closes.length < 2) return `<span class="muted">n/a</span>`;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const width = 180;
  const height = 46;
  const span = max - min || 1;
  const coords = closes.map((value, index) => {
    const x = closes.length === 1 ? 0 : (index / (closes.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const last = closes[closes.length - 1];
  const first = closes[0];
  const cls = last >= first ? "spark-good" : "spark-bad";
  return `<svg class="sparkline ${cls}" viewBox="0 0 ${width} ${height}" role="img" aria-label="close preview"><polyline points="${coords}"></polyline></svg>`;
}

function closedTradesByExit(tradeRows) {
  return (tradeRows || [])
    .filter((trade) => trade.state === "closed" && finiteNumber(trade.pnl) !== null && trade.exit_time)
    .sort((a, b) => String(a.exit_time).localeCompare(String(b.exit_time)));
}

function tradeCumulativePnlChart(tradeRows) {
  const ordered = closedTradesByExit(tradeRows);
  if (ordered.length < 2) return emptyChart("Need two or more closed trades for a realized PnL curve");
  let running = 0;
  const points = ordered.map((trade) => {
    running += Number(trade.pnl);
    return { timestamp: trade.exit_time, value: running };
  });
  return scalarLineChart(points, {
    label: "cumulative realized PnL",
    empty: "Need two or more closed trades for a realized PnL curve",
    className: points[points.length - 1].value >= 0 ? "spark-good" : "spark-bad",
    valueFormatter: money,
  });
}

function tradePnlBarChart(tradeRows) {
  const ordered = closedTradesByExit(tradeRows);
  if (!ordered.length) return emptyChart("No closed trades in the selected window");
  const width = 720;
  const height = 180;
  const padding = 12;
  const maxAbs = Math.max(0.01, ...ordered.map((trade) => Math.abs(Number(trade.pnl))));
  const barGap = 3;
  const barWidth = Math.max(2, (width - padding * 2 - barGap * Math.max(0, ordered.length - 1)) / ordered.length);
  const axisY = height / 2;
  const bars = ordered.map((trade, index) => {
    const value = Number(trade.pnl);
    const magnitude = (Math.abs(value) / maxAbs) * (height / 2 - padding);
    const x = padding + index * (barWidth + barGap);
    const y = value >= 0 ? axisY - magnitude : axisY;
    const cls = value >= 0 ? "return-bar-good" : "return-bar-bad";
    const label = `${text(trade.symbol)} ${text(trade.side)} ${money(value)} (${String(trade.exit_time).slice(0, 10)})`;
    return `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, magnitude).toFixed(1)}"><title>${escapeHtml(label)}</title></rect>`;
  }).join("");
  const best = ordered.reduce((acc, trade) => (Number(trade.pnl) > Number(acc.pnl) ? trade : acc), ordered[0]);
  const worst = ordered.reduce((acc, trade) => (Number(trade.pnl) < Number(acc.pnl) ? trade : acc), ordered[0]);
  const caption = `best ${text(best.symbol)} ${money(best.pnl)} / worst ${text(worst.symbol)} ${money(worst.pnl)}`;
  return `<svg class="detail-chart return-bars" viewBox="0 0 ${width} ${height}" role="img" aria-label="per-trade realized PnL bars"><line class="axis-line" x1="0" y1="${axisY}" x2="${width}" y2="${axisY}"></line>${bars}</svg><span class="chart-caption">${escapeHtml(caption)}</span>`;
}

function equitySparkline(accountRows) {
  const values = (accountRows || []).map((row) => Number(row.equity)).filter((value) => Number.isFinite(value));
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 360;
  const height = 56;
  const span = max - min || 1;
  const coords = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const cls = values[values.length - 1] >= values[0] ? "spark-good" : "spark-bad";
  return `<svg class="sparkline hero-spark ${cls}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="selected-source equity history"><polyline points="${coords}"></polyline></svg>`;
}

function emptyChart(message) {
  return `<div class="chart-empty">${escapeHtml(message)}</div>`;
}

function compactDataPreviewChart(dataset) {
  const points = (dataset && dataset.preview) || [];
  const rows = points.map((point) => ({
    timestamp: point.timestamp,
    millis: timestampMillis(point.timestamp),
    close: Number(point.close),
    volume: Number(point.volume),
  })).filter((point) => point.millis !== null && Number.isFinite(point.close));
  if (rows.length < 2) {
    return `<div class="empty-card"><strong>No preview chart</strong><span>Open Data Detail to fetch a fresh sampled view for this saved file.</span></div>`;
  }
  const closes = rows.map((point) => point.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const minTime = Math.min(...rows.map((point) => point.millis));
  const maxTime = Math.max(...rows.map((point) => point.millis));
  const width = 520;
  const priceHeight = 118;
  const volumeHeight = rows.some((point) => Number.isFinite(point.volume)) ? 28 : 0;
  const volumeGap = volumeHeight ? 10 : 0;
  const height = priceHeight + volumeGap + volumeHeight;
  const priceSpan = max - min || 1;
  const timeSpan = maxTime - minTime || 1;
  const xFor = (millis) => ((millis - minTime) / timeSpan) * width;
  const coords = rows.map((point) => {
    const x = xFor(point.millis);
    const y = priceHeight - ((point.close - min) / priceSpan) * priceHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const first = rows[0];
  const last = rows[rows.length - 1];
  const returnPct = first.close ? ((last.close - first.close) / first.close) : null;
  const cls = last.close >= first.close ? "spark-good" : "spark-bad";
  let volumeBars = "";
  const volumes = rows.map((point) => point.volume).filter((value) => Number.isFinite(value));
  if (volumes.length) {
    const maxVolume = Math.max(...volumes, 1);
    const barWidth = Math.max(1, width / rows.length);
    const baseY = priceHeight + volumeGap;
    volumeBars = rows.map((point) => {
      if (!Number.isFinite(point.volume)) return "";
      const x = Math.max(0, xFor(point.millis) - barWidth / 2);
      const barHeight = Math.max(1, (point.volume / maxVolume) * volumeHeight);
      const y = baseY + volumeHeight - barHeight;
      return `<rect class="volume-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}"></rect>`;
    }).join("");
  }
  const caption = `${text(dataset.symbol)} ${text(dataset.bar_size)} best-file preview / ${numberText(rows.length, 0)} sampled points / ${pctText(returnPct)}`;
  return `
    <div class="symbol-profile-chart-head">
      <strong>${escapeHtml(text(dataset.symbol))} Preview</strong>
      <span>${escapeHtml(rangeLabel(dataset.first_timestamp, dataset.last_timestamp))} / ${escapeHtml(text(dataset.source))} / ${escapeHtml(text(dataset.quality_status))}/${escapeHtml(text(dataset.storage_contract_status))}</span>
    </div>
    <svg class="detail-chart symbol-profile-preview ${cls}" viewBox="0 0 ${width} ${height}" role="img" aria-label="selected symbol best-file price preview">
      <polyline points="${coords}"><title>${escapeHtml(caption)}</title></polyline>
      ${volumeBars}
    </svg>
    <span class="chart-caption">${escapeHtml(caption)}</span>
  `;
}

function gapMarkerBands(gaps, width, priceHeight, minTime, maxTime, timezoneMode = "utc") {
  const timeSpan = maxTime - minTime || 1;
  return visibleGapRows(gaps, minTime, maxTime).map((gap) => {
    const start = timestampMillis(gap.from_timestamp);
    const end = timestampMillis(gap.to_timestamp);
    const x1 = Math.max(0, ((start - minTime) / timeSpan) * width);
    const x2 = Math.min(width, ((end - minTime) / timeSpan) * width);
    const bandWidth = Math.max(2, x2 - x1);
    const label = `${formatTimestampForMode(gap.from_timestamp, timezoneMode)} -> ${formatTimestampForMode(gap.to_timestamp, timezoneMode)} gap ${interval(gap.gap_seconds)}`;
    return `<rect class="gap-marker-band" x="${x1.toFixed(1)}" y="0" width="${bandWidth.toFixed(1)}" height="${priceHeight.toFixed(1)}"><title>${escapeHtml(label)}</title></rect><line class="gap-marker-line" x1="${x2.toFixed(1)}" y1="0" x2="${x2.toFixed(1)}" y2="${priceHeight.toFixed(1)}"><title>${escapeHtml(label)}</title></line>`;
  }).join("");
}

function visibleGapRows(gaps, minTime, maxTime) {
  return (gaps || []).filter((gap) => {
    const start = timestampMillis(gap.from_timestamp);
    const end = timestampMillis(gap.to_timestamp);
    return start !== null && end !== null && end > minTime && start < maxTime;
  });
}

function gapMarkerLegend(gaps, minTime, maxTime, timezoneMode = "utc") {
  const rows = gaps || [];
  if (!rows.length) return "";
  const visible = visibleGapRows(rows, minTime, maxTime);
  const largest = visible.slice().sort((left, right) => (
    (finiteNumber(right.gap_seconds) ?? finiteNumber(right.estimated_missing_intervals) ?? 0)
    - (finiteNumber(left.gap_seconds) ?? finiteNumber(left.estimated_missing_intervals) ?? 0)
  ))[0];
  const visibleText = `${numberText(visible.length, 0)} of ${numberText(rows.length, 0)} returned gap${rows.length === 1 ? "" : "s"} visible`;
  const detailText = largest
    ? `Largest visible ${interval(largest.gap_seconds)} from ${formatTimestampForMode(largest.from_timestamp, timezoneMode)} to ${formatTimestampForMode(largest.to_timestamp, timezoneMode)}`
    : "Returned gaps are outside the current chart window";
  return `<div class="chart-legend gap-marker-legend"><span class="legend-item"><span class="gap-legend-swatch"></span>${escapeHtml(visibleText)}</span><span class="muted">${escapeHtml(detailText)}</span></div>`;
}

function detailChart(points, timezoneMode = "utc", gaps = []) {
  if (!points || points.length < 2) return emptyChart("No price preview available");
  const rows = points.map((point) => ({
    timestamp: point.timestamp,
    millis: timestampMillis(point.timestamp),
    close: Number(point.close),
    volume: Number(point.volume),
  })).filter((point) => point.millis !== null && Number.isFinite(point.close));
  if (rows.length < 2) return emptyChart("No price preview available");
  const closes = rows.map((point) => point.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const minTime = Math.min(...rows.map((point) => point.millis));
  const maxTime = Math.max(...rows.map((point) => point.millis));
  const width = 720;
  const priceHeight = 160;
  const volumeHeight = rows.some((point) => Number.isFinite(point.volume)) ? 44 : 0;
  const volumeGap = volumeHeight ? 16 : 0;
  const height = priceHeight + volumeGap + volumeHeight;
  const span = max - min || 1;
  const timeSpan = maxTime - minTime || 1;
  const xFor = (millis) => ((millis - minTime) / timeSpan) * width;
  const coords = rows.map((point, index) => {
    const x = rows.length === 1 ? 0 : xFor(point.millis);
    const y = priceHeight - ((point.close - min) / span) * priceHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const last = closes[closes.length - 1];
  const first = closes[0];
  const cls = last >= first ? "spark-good" : "spark-bad";
  let volumeBars = "";
  const volumes = rows.map((point) => point.volume).filter((value) => Number.isFinite(value));
  if (volumes.length) {
    const maxVolume = Math.max(...volumes, 1);
    const barWidth = Math.max(1, width / rows.length);
    const baseY = priceHeight + volumeGap;
    volumeBars = rows.map((point) => {
      if (!Number.isFinite(point.volume)) return "";
      const x = Math.max(0, xFor(point.millis) - barWidth / 2);
      const barHeight = Math.max(1, (point.volume / maxVolume) * volumeHeight);
      const y = baseY + volumeHeight - barHeight;
      return `<rect class="volume-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}"><title>${escapeHtml(formatTimestampForMode(point.timestamp, timezoneMode))} volume ${escapeHtml(numberText(point.volume, 0))}</title></rect>`;
    }).join("");
  }
  const gapMarkers = gapMarkerBands(gaps, width, priceHeight, minTime, maxTime, timezoneMode);
  const gapLegend = gapMarkerLegend(gaps, minTime, maxTime, timezoneMode);
  const caption = `${formatTimestampForMode(rows[0].timestamp, timezoneMode)} close ${numberText(first)} | ${formatTimestampForMode(rows[rows.length - 1].timestamp, timezoneMode)} close ${numberText(last)}`;
  return `<svg class="detail-chart ${cls}" viewBox="0 0 ${width} ${height}" role="img" aria-label="saved data price, gaps, and volume">${gapMarkers}<polyline points="${coords}"><title>${escapeHtml(caption)}</title></polyline>${volumeBars}</svg>${gapLegend}<span class="chart-caption">${escapeHtml(caption)}</span>`;
}

function candlestickChart(points, timezoneMode = "utc", gaps = []) {
  if (!points || points.length < 2) return detailChart(points, timezoneMode, gaps);
  const rows = points.map((point) => ({
    timestamp: point.timestamp,
    millis: timestampMillis(point.timestamp),
    open: Number(point.open),
    high: Number(point.high),
    low: Number(point.low),
    close: Number(point.close),
    volume: Number(point.volume),
  })).filter((point) => (
    point.millis !== null
    && Number.isFinite(point.open)
    && Number.isFinite(point.high)
    && Number.isFinite(point.low)
    && Number.isFinite(point.close)
  ));
  if (rows.length < 2) return detailChart(points, timezoneMode, gaps);
  const lows = rows.map((point) => point.low);
  const highs = rows.map((point) => point.high);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const minTime = Math.min(...rows.map((point) => point.millis));
  const maxTime = Math.max(...rows.map((point) => point.millis));
  const width = 720;
  const priceHeight = 170;
  const volumeHeight = rows.some((point) => Number.isFinite(point.volume)) ? 44 : 0;
  const volumeGap = volumeHeight ? 16 : 0;
  const height = priceHeight + volumeGap + volumeHeight;
  const span = max - min || 1;
  const timeSpan = maxTime - minTime || 1;
  const xFor = (millis) => ((millis - minTime) / timeSpan) * width;
  const xStep = rows.length === 1 ? width : width / (rows.length - 1);
  const candleWidth = Math.max(2, Math.min(10, xStep * 0.55));
  const yFor = (value) => priceHeight - ((value - min) / span) * priceHeight;
  const candles = rows.map((point, index) => {
    const x = rows.length === 1 ? width / 2 : xFor(point.millis);
    const openY = yFor(point.open);
    const closeY = yFor(point.close);
    const highY = yFor(point.high);
    const lowY = yFor(point.low);
    const top = Math.min(openY, closeY);
    const bodyHeight = Math.max(1, Math.abs(openY - closeY));
    const cls = point.close >= point.open ? "candle-good" : "candle-bad";
    const label = `${formatTimestampForMode(point.timestamp, timezoneMode)} O ${numberText(point.open)} H ${numberText(point.high)} L ${numberText(point.low)} C ${numberText(point.close)}`;
    return `<g class="${cls}"><line class="candle-wick" x1="${x.toFixed(1)}" y1="${highY.toFixed(1)}" x2="${x.toFixed(1)}" y2="${lowY.toFixed(1)}"><title>${escapeHtml(label)}</title></line><rect class="candle-body" x="${(x - candleWidth / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${candleWidth.toFixed(1)}" height="${bodyHeight.toFixed(1)}"><title>${escapeHtml(label)}</title></rect></g>`;
  }).join("");
  let volumeBars = "";
  const volumes = rows.map((point) => point.volume).filter((value) => Number.isFinite(value));
  if (volumes.length) {
    const maxVolume = Math.max(...volumes, 1);
    const barWidth = Math.max(1, width / rows.length);
    const baseY = priceHeight + volumeGap;
    volumeBars = rows.map((point) => {
      if (!Number.isFinite(point.volume)) return "";
      const x = Math.max(0, xFor(point.millis) - barWidth / 2);
      const barHeight = Math.max(1, (point.volume / maxVolume) * volumeHeight);
      const y = baseY + volumeHeight - barHeight;
      return `<rect class="volume-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}"><title>${escapeHtml(formatTimestampForMode(point.timestamp, timezoneMode))} volume ${escapeHtml(numberText(point.volume, 0))}</title></rect>`;
    }).join("");
  }
  const gapMarkers = gapMarkerBands(gaps, width, priceHeight, minTime, maxTime, timezoneMode);
  const gapLegend = gapMarkerLegend(gaps, minTime, maxTime, timezoneMode);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const caption = `${formatTimestampForMode(first.timestamp, timezoneMode)} close ${numberText(first.close)} | ${formatTimestampForMode(last.timestamp, timezoneMode)} close ${numberText(last.close)}`;
  return `<svg class="detail-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="saved data candlestick, gaps, and volume">${gapMarkers}${candles}${volumeBars}</svg>${gapLegend}<span class="chart-caption">${escapeHtml(caption)}</span>`;
}

function compareChart(series, timezoneMode = "utc") {
  const rows = (series || []).map((item) => ({
    symbol: item.symbol,
    points: (item.points || []).map((point) => ({
      timestamp: point.timestamp,
      millis: timestampMillis(point.timestamp),
      value: Number(point.normalized_return_pct),
    })).filter((point) => point.millis !== null && Number.isFinite(point.value)),
  })).filter((item) => item.points.length >= 2);
  const allPoints = rows.flatMap((item) => item.points);
  if (rows.length < 2 || allPoints.length < 4) {
    return emptyChart("Select at least two datasets with comparable close paths.");
  }
  const minTime = Math.min(...allPoints.map((point) => point.millis));
  const maxTime = Math.max(...allPoints.map((point) => point.millis));
  const minValue = Math.min(...allPoints.map((point) => point.value));
  const maxValue = Math.max(...allPoints.map((point) => point.value));
  const width = 720;
  const height = 220;
  const timeSpan = maxTime - minTime || 1;
  const valueSpan = maxValue - minValue || 1;
  const colors = ["#00a76f", "#2563eb", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#be123c", "#4d7c0f"];
  const polylines = rows.map((item, index) => {
    const coords = item.points.map((point) => {
      const x = ((point.millis - minTime) / timeSpan) * width;
      const y = height - ((point.value - minValue) / valueSpan) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return `<polyline points="${coords}" fill="none" stroke="${colors[index % colors.length]}" stroke-width="2"><title>${escapeHtml(item.symbol)}</title></polyline>`;
  }).join("");
  const axisY = maxValue >= 0 && minValue <= 0
    ? height - ((0 - minValue) / valueSpan) * height
    : null;
  const zeroLine = axisY === null
    ? ""
    : `<line class="axis-line" x1="0" y1="${axisY.toFixed(1)}" x2="${width}" y2="${axisY.toFixed(1)}"></line>`;
  const legend = rows.map((item, index) => (
    `<span class="legend-item"><span style="background:${colors[index % colors.length]}"></span>${escapeHtml(item.symbol)}</span>`
  )).join("");
  const caption = `${formatTimestampForMode(new Date(minTime).toISOString(), timezoneMode)} -> ${formatTimestampForMode(new Date(maxTime).toISOString(), timezoneMode)} normalized close return`;
  return `<svg class="detail-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="saved data comparison">${zeroLine}${polylines}</svg><div class="chart-legend">${legend}</div><span class="chart-caption">${escapeHtml(caption)}</span>`;
}

function equityChart(points, markers = []) {
  if (!points || points.length < 2) return emptyChart("No equity curve available");
  const rows = (points || []).map((point, index) => ({
    index,
    timestamp: point.timestamp,
    millis: timestampMillis(point.timestamp),
    equity: Number(point.equity),
  })).filter((point) => Number.isFinite(point.equity));
  const values = rows.map((point) => point.equity);
  if (values.length < 2) return emptyChart("No equity curve available");
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 720;
  const height = 180;
  const span = max - min || 1;
  const xForIndex = (index) => (values.length === 1 ? 0 : (index / (values.length - 1)) * width);
  const yForValue = (value) => height - ((value - min) / span) * height;
  const coords = rows.map((point, index) => {
    const x = xForIndex(index);
    const y = yForValue(point.equity);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const rowForMarker = (marker) => {
    const markerMillis = timestampMillis(marker.timestamp);
    if (markerMillis === null) return null;
    return rows.reduce((best, point, index) => {
      if (point.millis === null) return best;
      const distance = Math.abs(point.millis - markerMillis);
      return !best || distance < best.distance ? { point, index, distance } : best;
    }, null);
  };
  const chartMarkers = (markers || []).slice(0, 40).map((marker) => {
    const match = rowForMarker(marker);
    if (!match) return null;
    const type = String(marker.type || "event").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
    const x = xForIndex(match.index);
    const y = yForValue(match.point.equity);
    const label = [marker.type, marker.symbol, marker.label, marker.timestamp].map(text).filter((value) => value !== "n/a").join(" ");
    return { type, x, y, label };
  }).filter(Boolean);
  const markerElements = chartMarkers.map((marker) => (
    `<circle class="chart-marker marker-${escapeHtml(marker.type)}" cx="${marker.x.toFixed(1)}" cy="${marker.y.toFixed(1)}" r="4"><title>${escapeHtml(marker.label)}</title></circle>`
  )).join("");
  const markerGroups = [
    ["entry-fill", "Entry fills"],
    ["exit-fill", "Exit fills"],
    ["entry-marker", "Entry markers"],
    ["exit-marker", "Exit markers"],
  ].map(([type, label]) => ({
    type,
    label,
    count: chartMarkers.filter((marker) => marker.type === type).length,
  })).filter((item) => item.count > 0);
  const markerLegend = markerGroups.length
    ? `<div class="chart-legend marker-legend">${markerGroups.map((item) => `<span class="legend-item marker-${escapeHtml(item.type)}"><span></span>${escapeHtml(item.label)} ${numberText(item.count, 0)}</span>`).join("")}</div>`
    : "";
  const cls = values[values.length - 1] >= values[0] ? "spark-good" : "spark-bad";
  return `<svg class="detail-chart ${cls}" viewBox="0 0 ${width} ${height}" role="img" aria-label="equity curve"><polyline points="${coords}"></polyline>${markerElements}</svg>${markerLegend}`;
}

function normalizedReturnPoints(rows, valueKey) {
  const ordered = (rows || []).map((point) => ({
    timestamp: point.timestamp,
    millis: timestampMillis(point.timestamp),
    value: Number(point[valueKey]),
  })).filter((point) => point.millis !== null && Number.isFinite(point.value))
    .sort((a, b) => a.millis - b.millis);
  const base = ordered.find((point) => point.value !== 0);
  if (!base) return [];
  return ordered.map((point) => ({
    timestamp: point.timestamp,
    millis: point.millis,
    value: ((point.value / base.value) - 1) * 100,
  })).filter((point) => Number.isFinite(point.value));
}

function benchmarkOverlayChart(accountRows, benchmarkDetail) {
  const accountPoints = normalizedReturnPoints(accountRows, "equity");
  const benchmarkPoints = normalizedReturnPoints((benchmarkDetail && benchmarkDetail.preview) || [], "close");
  if (accountPoints.length < 2) {
    return emptyChart("Load account snapshots to compare against a benchmark.");
  }
  if (!benchmarkDetail || !benchmarkDetail.path) {
    return emptyChart("Choose a saved dataset, then load the benchmark overlay.");
  }
  if (benchmarkPoints.length < 2) {
    return emptyChart("Selected benchmark has no plottable close path.");
  }
  const series = [
    { label: "Strategy", points: accountPoints, className: "benchmark-strategy-line" },
    { label: benchmarkDetail.symbol || "Benchmark", points: benchmarkPoints, className: "benchmark-market-line" },
  ];
  const allPoints = series.flatMap((item) => item.points);
  const minTime = Math.min(...allPoints.map((point) => point.millis));
  const maxTime = Math.max(...allPoints.map((point) => point.millis));
  const minValue = Math.min(0, ...allPoints.map((point) => point.value));
  const maxValue = Math.max(0, ...allPoints.map((point) => point.value));
  const width = 720;
  const height = 180;
  const timeSpan = maxTime - minTime || 1;
  const valueSpan = maxValue - minValue || 1;
  const yFor = (value) => height - ((value - minValue) / valueSpan) * height;
  const lineFor = (item) => {
    const coords = item.points.map((point) => {
      const x = ((point.millis - minTime) / timeSpan) * width;
      const y = yFor(point.value);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return `<polyline class="${escapeHtml(item.className)}" points="${coords}"><title>${escapeHtml(item.label)}</title></polyline>`;
  };
  const zeroY = yFor(0).toFixed(1);
  const legend = series.map((item) => (
    `<span class="legend-item ${escapeHtml(item.className)}"><span></span>${escapeHtml(item.label)}</span>`
  )).join("");
  const accountLatest = accountPoints[accountPoints.length - 1].value;
  const benchmarkLatest = benchmarkPoints[benchmarkPoints.length - 1].value;
  const caption = `Strategy ${pctText(accountLatest)} / ${text(benchmarkDetail.symbol || "benchmark")} ${pctText(benchmarkLatest)} normalized return`;
  return `<svg class="detail-chart benchmark-overlay" viewBox="0 0 ${width} ${height}" role="img" aria-label="strategy and benchmark normalized return overlay"><line class="axis-line" x1="0" y1="${zeroY}" x2="${width}" y2="${zeroY}"></line>${series.map(lineFor).join("")}</svg><div class="chart-legend">${legend}</div><span class="chart-caption">${escapeHtml(caption)}</span>`;
}

function numericAccountRows(points) {
  return (points || []).map((point) => ({
    timestamp: point.timestamp,
    equity: Number(point.equity),
  })).filter((point) => point.timestamp && Number.isFinite(point.equity));
}

function latestSessionAccountRows(points) {
  const rows = numericAccountRows(points).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  if (!rows.length) return [];
  const latestDay = String(rows[rows.length - 1].timestamp).slice(0, 10);
  return rows.filter((point) => String(point.timestamp).slice(0, 10) === latestDay);
}

function intradayPnlStats(points) {
  const rows = numericAccountRows(points).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  if (!rows.length) return null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const pnls = rows.map((point) => point.equity - first.equity);
  const pnl = last.equity - first.equity;
  return {
    day: String(last.timestamp).slice(0, 10),
    start_time: first.timestamp,
    end_time: last.timestamp,
    count: rows.length,
    pnl,
    return_pct: first.equity > 0 ? (pnl / first.equity) * 100 : null,
    high_pnl: Math.max(...pnls),
    low_pnl: Math.min(...pnls),
  };
}

function intradayPnlChart(points) {
  const rows = numericAccountRows(points).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  if (rows.length < 2) return emptyChart("No intraday PnL curve available");
  const base = rows[0].equity;
  const values = rows.map((point) => point.equity - base).filter((value) => Number.isFinite(value));
  if (values.length < 2) return emptyChart("No intraday PnL curve available");
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const width = 720;
  const height = 180;
  const span = max - min || 1;
  const yFor = (value) => height - ((value - min) / span) * height;
  const coords = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
    const y = yFor(value);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const finalPnl = values[values.length - 1];
  const cls = finalPnl >= 0 ? "spark-good" : "spark-bad";
  const zeroY = yFor(0).toFixed(1);
  const caption = `${String(rows[0].timestamp).slice(0, 10)} session PnL ${money(finalPnl)} from ${numberText(rows.length, 0)} snapshots`;
  return `<svg class="detail-chart ${cls}" viewBox="0 0 ${width} ${height}" role="img" aria-label="intraday profit and loss curve"><line class="axis-line" x1="0" y1="${zeroY}" x2="${width}" y2="${zeroY}"></line><polyline points="${coords}"></polyline></svg><span class="chart-caption">${escapeHtml(caption)}</span>`;
}

function drawdownChart(points) {
  const rows = numericAccountRows(points);
  if (rows.length < 2) return emptyChart("No drawdown curve available");
  let peak = rows[0].equity;
  const values = rows.map((point) => {
    peak = Math.max(peak, point.equity);
    const drawdown = peak > 0 ? ((point.equity / peak) - 1) * 100 : 0;
    return { timestamp: point.timestamp, value: drawdown };
  });
  return scalarLineChart(values, {
    label: "drawdown curve",
    empty: "No drawdown curve available",
    className: "spark-bad",
    valueFormatter: pctText,
  });
}

function dailyReturns(points) {
  const rows = numericAccountRows(points);
  const byDay = new Map();
  for (const point of rows) {
    const day = String(point.timestamp).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(point);
  }
  return Array.from(byDay.entries()).map(([day, items]) => {
    const ordered = items.slice().sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const first = ordered[0].equity;
    const last = ordered[ordered.length - 1].equity;
    const value = first > 0 ? ((last / first) - 1) * 100 : 0;
    return { day, value };
  }).filter((item) => Number.isFinite(item.value));
}

function dailyReturnChart(points) {
  const rows = dailyReturns(points);
  if (!rows.length) return emptyChart("No daily return bars available");
  const width = 720;
  const height = 180;
  const padding = 12;
  const maxAbs = Math.max(0.01, ...rows.map((item) => Math.abs(item.value)));
  const barGap = 4;
  const barWidth = Math.max(3, (width - padding * 2 - barGap * Math.max(0, rows.length - 1)) / rows.length);
  const axisY = height / 2;
  const bars = rows.map((item, index) => {
    const magnitude = (Math.abs(item.value) / maxAbs) * (height / 2 - padding);
    const x = padding + index * (barWidth + barGap);
    const y = item.value >= 0 ? axisY - magnitude : axisY;
    const cls = item.value >= 0 ? "return-bar-good" : "return-bar-bad";
    return `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, magnitude).toFixed(1)}"><title>${escapeHtml(item.day)} ${escapeHtml(pctText(item.value))}</title></rect>`;
  }).join("");
  const labels = rows.slice(-3).map((item) => `${item.day} ${pctText(item.value)}`).join(" | ");
  return `<svg class="detail-chart return-bars" viewBox="0 0 ${width} ${height}" role="img" aria-label="daily return bars"><line class="axis-line" x1="0" y1="${axisY}" x2="${width}" y2="${axisY}"></line>${bars}</svg><span class="chart-caption">${escapeHtml(labels)}</span>`;
}

function eventTimelineChart(events) {
  const rows = (events || [])
    .map((event) => ({ ...event, millis: timestampMillis(event.timestamp) }))
    .filter((event) => event.millis !== null);
  if (!rows.length) return emptyChart("No events in the current filter window");
  const minMillis = Math.min(...rows.map((event) => event.millis));
  const maxMillis = Math.max(...rows.map((event) => event.millis));
  const hourMs = 60 * 60 * 1000;
  const daily = maxMillis - minMillis > 48 * hourMs;
  const bucketMs = daily ? 24 * hourMs : hourMs;
  const buckets = new Map();
  for (const event of rows) {
    const key = Math.floor(event.millis / bucketMs) * bucketMs;
    if (!buckets.has(key)) buckets.set(key, { decision: 0, order: 0, fill: 0, bad: 0 });
    const bucket = buckets.get(key);
    if (eventStatusIsBad(event)) bucket.bad += 1;
    else if (event.type === "fill") bucket.fill += 1;
    else if (event.type === "order") bucket.order += 1;
    else bucket.decision += 1;
  }
  const ordered = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
  const width = 720;
  const height = 140;
  const padding = 12;
  const maxTotal = Math.max(1, ...ordered.map(([, b]) => b.decision + b.order + b.fill + b.bad));
  const barGap = 2;
  const barWidth = Math.min(48, Math.max(3, (width - padding * 2 - barGap * Math.max(0, ordered.length - 1)) / ordered.length));
  const groupWidth = ordered.length * barWidth + Math.max(0, ordered.length - 1) * barGap;
  const offset = Math.max(padding, (width - groupWidth) / 2);
  const scale = (height - padding * 2) / maxTotal;
  const segments = [["decision", "event-seg-decision"], ["order", "event-seg-order"], ["fill", "event-seg-fill"], ["bad", "event-seg-bad"]];
  const bars = ordered.map(([key, bucket], index) => {
    const x = offset + index * (barWidth + barGap);
    const label = daily ? new Date(key).toISOString().slice(0, 10) : new Date(key).toISOString().slice(0, 13) + ":00Z";
    const total = bucket.decision + bucket.order + bucket.fill + bucket.bad;
    let y = height - padding;
    const parts = segments.map(([kind, cls]) => {
      const count = bucket[kind];
      if (!count) return "";
      const segmentHeight = Math.max(1, count * scale);
      y -= segmentHeight;
      return `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${segmentHeight.toFixed(1)}"><title>${escapeHtml(`${label}: ${count} ${kind === "bad" ? "rejected/issue" : kind} of ${total} events`)}</title></rect>`;
    }).join("");
    return parts;
  }).join("");
  const peak = ordered.reduce((acc, item) => {
    const total = item[1].decision + item[1].order + item[1].fill + item[1].bad;
    return total > acc.total ? { key: item[0], total } : acc;
  }, { key: ordered[0][0], total: 0 });
  const peakLabel = daily ? new Date(peak.key).toISOString().slice(0, 10) : new Date(peak.key).toISOString().slice(11, 16) + " UTC";
  const caption = `${numberText(ordered.length, 0)} ${daily ? "day" : "hour"} buckets; peak ${numberText(peak.total, 0)} events at ${peakLabel}`;
  const legend = `<div class="chart-legend event-timeline-legend"><span class="legend-item event-seg-decision"><span></span>decisions</span><span class="legend-item event-seg-order"><span></span>orders</span><span class="legend-item event-seg-fill"><span></span>fills</span><span class="legend-item event-seg-bad"><span></span>rejected/issues</span></div>`;
  return `<svg class="detail-chart event-timeline" viewBox="0 0 ${width} ${height}" role="img" aria-label="event density over time">${bars}</svg>${legend}<span class="chart-caption">${escapeHtml(caption)}</span>`;
}

function periodReturnBarChart(periodRows) {
  const rows = (periodRows || [])
    .map((item) => ({ label: text(item.periodLabel || item.label), value: Number(item.total_return_pct) }))
    .filter((item) => Number.isFinite(item.value));
  if (!rows.length) return emptyChart("No period rollups available yet");
  const width = 720;
  const height = 160;
  const padding = 12;
  const maxAbs = Math.max(0.01, ...rows.map((item) => Math.abs(item.value)));
  const barGap = 14;
  const barWidth = Math.min(90, Math.max(24, (width - padding * 2 - barGap * Math.max(0, rows.length - 1)) / rows.length));
  const axisY = height / 2;
  const groupWidth = rows.length * barWidth + Math.max(0, rows.length - 1) * barGap;
  const offset = Math.max(padding, (width - groupWidth) / 2);
  const bars = rows.map((item, index) => {
    const magnitude = (Math.abs(item.value) / maxAbs) * (height / 2 - padding);
    const x = offset + index * (barWidth + barGap);
    const y = item.value >= 0 ? axisY - magnitude : axisY;
    const cls = item.value >= 0 ? "return-bar-good" : "return-bar-bad";
    return `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, magnitude).toFixed(1)}"><title>${escapeHtml(`${item.label} ${pctText(item.value)}`)}</title></rect>`;
  }).join("");
  const caption = rows.map((item) => `${item.label} ${pctText(item.value)}`).join(" | ");
  return `<svg class="detail-chart return-bars" viewBox="0 0 ${width} ${height}" role="img" aria-label="period return bars"><line class="axis-line" x1="0" y1="${axisY}" x2="${width}" y2="${axisY}"></line>${bars}</svg><span class="chart-caption">${escapeHtml(caption)}</span>`;
}

function calendarReturnHeatmap(points) {
  const rows = dailyReturns(points).sort((a, b) => String(a.day).localeCompare(String(b.day)));
  if (!rows.length) return emptyChart("No daily returns available for calendar view");
  const byDay = new Map(rows.map((item) => [item.day, item.value]));
  const maxAbs = Math.max(0.01, ...rows.map((item) => Math.abs(item.value)));
  const start = new Date(`${rows[0].day}T00:00:00Z`);
  const end = new Date(`${rows[rows.length - 1].day}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const cells = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.toISOString().slice(0, 10);
    const value = byDay.get(day);
    let cls = "calendar-cell-empty";
    let label = `${day} no account return`;
    if (Number.isFinite(value)) {
      const intensity = Math.min(4, Math.max(1, Math.ceil((Math.abs(value) / maxAbs) * 4)));
      cls = value >= 0 ? `calendar-good-${intensity}` : `calendar-bad-${intensity}`;
      label = `${day} ${pctText(value)}`;
    }
    cells.push(`<span class="calendar-cell ${cls}" title="${escapeHtml(label)}"></span>`);
  }
  const latest = rows.slice(-5).map((item) => `${item.day} ${pctText(item.value)}`).join(" | ");
  return `<div class="calendar-scroll"><div class="calendar-heatmap" role="img" aria-label="daily return calendar heatmap">${cells.join("")}</div></div><span class="chart-caption">${escapeHtml(latest)}</span>`;
}

function scalarLineChart(points, { label, empty, className, valueFormatter }) {
  if (!points || points.length < 2) return emptyChart(empty);
  const values = points.map((point) => Number(point.value)).filter((value) => Number.isFinite(value));
  if (values.length < 2) return emptyChart(empty);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 720;
  const height = 180;
  const span = max - min || 1;
  const coords = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const latest = values[values.length - 1];
  const caption = `${valueFormatter ? valueFormatter(latest) : numberText(latest)} latest`;
  return `<svg class="detail-chart ${className || ""}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}"><polyline points="${coords}"></polyline></svg><span class="chart-caption">${escapeHtml(caption)}</span>`;
}

function statusRollupChartRows(rollups, valueKey) {
  return (rollups || []).map((item) => ({
    day: item.day,
    node_id: text(item.node_id),
    millis: timestampMillis(`${item.day}T00:00:00Z`),
    value: Number(item[valueKey]),
  })).filter((item) => item.day && item.millis !== null && Number.isFinite(item.value))
    .sort((left, right) => (left.millis - right.millis) || left.node_id.localeCompare(right.node_id));
}

function statusRollupEquityChart(rollups) {
  const rows = statusRollupChartRows(rollups, "end_equity");
  if (rows.length < 2) return emptyChart("No status-history equity curve available");
  const byNode = new Map();
  for (const item of rows) {
    if (!byNode.has(item.node_id)) byNode.set(item.node_id, []);
    byNode.get(item.node_id).push(item);
  }
  const drawable = Array.from(byNode.entries()).filter(([, items]) => items.length >= 2);
  if (!drawable.length) return emptyChart("Need at least two status-history equity days for one node.");
  const values = rows.map((item) => item.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const minTime = Math.min(...rows.map((item) => item.millis));
  const maxTime = Math.max(...rows.map((item) => item.millis));
  const width = 720;
  const height = 180;
  const valueSpan = maxValue - minValue || 1;
  const timeSpan = maxTime - minTime || 1;
  const colors = ["#00a76f", "#2563eb", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#be123c", "#4d7c0f"];
  const lines = drawable.map(([node, items], index) => {
    const coords = items.map((item) => {
      const x = ((item.millis - minTime) / timeSpan) * width;
      const y = height - ((item.value - minValue) / valueSpan) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return `<polyline points="${coords}" fill="none" stroke="${colors[index % colors.length]}" stroke-width="2"><title>${escapeHtml(node)}</title></polyline>`;
  }).join("");
  const legend = drawable.map(([node], index) => (
    `<span class="legend-item"><span style="background:${colors[index % colors.length]}"></span>${escapeHtml(node)}</span>`
  )).join("");
  const latest = rows[rows.length - 1];
  const caption = `${escapeHtml(latest.day)} ${escapeHtml(latest.node_id)} end equity ${escapeHtml(money(latest.value))}`;
  return `<svg class="detail-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="status-history equity by node">${lines}</svg><div class="chart-legend">${legend}</div><span class="chart-caption">${caption}</span>`;
}

function statusRollupReturnChart(rollups) {
  const rows = statusRollupChartRows(rollups, "daily_return_pct").slice(-60);
  if (!rows.length) return emptyChart("No status-history daily returns available");
  const width = 720;
  const height = 180;
  const padding = 12;
  const maxAbs = Math.max(0.01, ...rows.map((item) => Math.abs(item.value)));
  const barGap = 4;
  const barWidth = Math.max(3, (width - padding * 2 - barGap * Math.max(0, rows.length - 1)) / rows.length);
  const axisY = height / 2;
  const bars = rows.map((item, index) => {
    const magnitude = (Math.abs(item.value) / maxAbs) * (height / 2 - padding);
    const x = padding + index * (barWidth + barGap);
    const y = item.value >= 0 ? axisY - magnitude : axisY;
    const cls = item.value >= 0 ? "return-bar-good" : "return-bar-bad";
    const label = `${item.day} ${item.node_id} ${pctText(item.value)}`;
    return `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, magnitude).toFixed(1)}"><title>${escapeHtml(label)}</title></rect>`;
  }).join("");
  const labels = rows.slice(-3).map((item) => `${item.day} ${item.node_id} ${pctText(item.value)}`).join(" | ");
  return `<svg class="detail-chart return-bars" viewBox="0 0 ${width} ${height}" role="img" aria-label="status-history daily return bars"><line class="axis-line" x1="0" y1="${axisY}" x2="${width}" y2="${axisY}"></line>${bars}</svg><span class="chart-caption">${escapeHtml(labels)}</span>`;
}

