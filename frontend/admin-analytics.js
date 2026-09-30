const app = document.getElementById("analyticsApp");

const state = {
  range: "today",
  customStart: null,
  customEnd: null,
  report: null,
  loading: false
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c] ?? c));
}

function fmtNumber(value) {
  return new Intl.NumberFormat().format(Math.round(Number(value) || 0));
}

function fmtPercent(value) {
  if (value === null || value === undefined) return "n/a";
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return (number > 0 ? "+" : "") + number.toFixed(1) + "%";
}

function localDayStart(offsetDays = 0) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
}

function rangeForPreset(preset) {
  const now = new Date();

  if (preset === "today") {
    return { start: localDayStart(0), end: now };
  }

  if (preset === "yesterday") {
    return { start: localDayStart(-1), end: localDayStart(0) };
  }

  if (preset === "7d") {
    return { start: localDayStart(-6), end: now };
  }

  if (preset === "30d") {
    return { start: localDayStart(-29), end: now };
  }

  return {
    start: state.customStart ? new Date(state.customStart) : localDayStart(0),
    end: state.customEnd ? new Date(state.customEnd) : now
  };
}

function toIsoMinute(value) {
  return new Date(value).toISOString();
}

function dateLabel(value) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function bucketLabel(timestamp, daily) {
  const date = new Date(Number(timestamp) * 1000);
  return daily
    ? date.toLocaleDateString([], { month: "short", day: "numeric" })
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function metricCard(label, value, comparison) {
  const delta = comparison === null || comparison === undefined ? "" :
    '<div class="metric-delta ' + (comparison >= 0 ? "up" : "down") + '">' +
    escapeHtml(fmtPercent(comparison)) + " vs previous period</div>";

  return '<article class="metric-card"><div class="metric-label">' +
    escapeHtml(label) + '</div><div class="metric-value">' +
    escapeHtml(fmtNumber(value)) + '</div>' + delta + '</article>';
}

function drawLineChart(canvas, rows, key, label) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.round(rect.width));
  const height = 280;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.height = height + "px";

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const values = rows.map(row => Number(row[key]) || 0);
  const max = Math.max(1, ...values);
  const min = 0;
  const pad = { top: 26, right: 18, bottom: 42, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  ctx.font = "12px system-ui, sans-serif";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= 4; i++) {
    const y = pad.top + plotH - (plotH * i / 4);
    const value = min + (max - min) * i / 4;
    ctx.strokeStyle = "#263241";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = "#8d9aaa";
    ctx.textAlign = "right";
    ctx.fillText(fmtNumber(value), pad.left - 8, y);
  }

  if (!rows.length) {
    ctx.fillStyle = "#8d9aaa";
    ctx.textAlign = "center";
    ctx.fillText("No data in this range.", width / 2, height / 2);
    return;
  }

  const step = rows.length === 1 ? plotW : plotW / (rows.length - 1);
  ctx.strokeStyle = "#79a8ff";
  ctx.lineWidth = 2.5;
  ctx.beginPath();

  rows.forEach((row, index) => {
    const x = pad.left + index * step;
    const y = pad.top + plotH - ((Number(row[key]) || 0) / max) * plotH;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();

  rows.forEach((row, index) => {
    const x = pad.left + index * step;
    const y = pad.top + plotH - ((Number(row[key]) || 0) / max) * plotH;
    ctx.fillStyle = "#79a8ff";
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  const daily = Number(state.report?.range?.bucketSeconds || 3600) >= 86400;
  const labelEvery = Math.max(1, Math.ceil(rows.length / 7));
  ctx.fillStyle = "#8d9aaa";
  ctx.textAlign = "center";
  rows.forEach((row, index) => {
    if (index % labelEvery !== 0 && index !== rows.length - 1) return;
    const x = pad.left + index * step;
    ctx.fillText(bucketLabel(row.bucket, daily), x, height - 18);
  });

  ctx.fillStyle = "#e7eef7";
  ctx.textAlign = "left";
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.fillText(label, pad.left, 14);
}

function render() {
  const report = state.report;

  if (state.loading) {
    app.innerHTML = '<div class="panel loading">Loading private analytics...</div>';
    return;
  }

  if (!report) {
    app.innerHTML = '<div class="panel error">No analytics report available.</div>';
    return;
  }

  const s = report.summary || {};
  const c = report.comparison || {};
  const range = report.range || {};
  const status = Number(range.bucketSeconds || 3600) >= 86400 ? "daily buckets" : "hourly buckets";

  app.innerHTML =
    '<div class="analytics-toolbar">' +
      '<div class="preset-group" role="group" aria-label="Analytics date range">' +
        ['today','yesterday','7d','30d'].map(key =>
          '<button class="preset ' + (state.range === key ? "active" : "") + '" data-range="' + key + '">' +
          ({today:"Today",yesterday:"Yesterday","7d":"Last 7 days","30d":"Last 30 days"}[key]) +
          '</button>'
        ).join("") +
        '<button class="preset ' + (state.range === "custom" ? "active" : "") + '" data-range="custom">Custom</button>' +
      '</div>' +
      '<div class="custom-controls">' +
        '<label>Start <input id="customStart" type="datetime-local"></label>' +
        '<label>End <input id="customEnd" type="datetime-local"></label>' +
        '<button id="applyCustom" class="apply">Apply</button>' +
        '<button id="refresh" class="refresh">Refresh</button>' +
      '</div>' +
    '</div>' +

    '<div class="range-status panel">' +
      '<div><strong>' + escapeHtml(dateLabel(range.start)) + '</strong> to <strong>' +
        escapeHtml(dateLabel(range.end)) + '</strong></div>' +
      '<div class="muted">Updated ' + escapeHtml(dateLabel(report.generatedAt)) + ' · ' +
        escapeHtml(status) + '</div>' +
    '</div>' +

    '<section class="metrics">' +
      metricCard("Visitors", s.observedVisitors, c.visitorsPercent) +
      metricCard("Page views", s.pageViews, c.pageViewsPercent) +
      metricCard("Sessions", s.observedSessions, c.sessionsPercent) +
      metricCard("Events", s.weightedEvents, c.weightedEventsPercent) +
      metricCard("Returning visitors", s.returningVisitors, null) +
      metricCard("Active visitors", s.activeVisitors, null) +
    '</section>' +

    '<section class="chart-grid">' +
      '<article class="panel chart-card"><canvas id="visitorsChart" aria-label="Visitors over time"></canvas></article>' +
      '<article class="panel chart-card"><canvas id="viewsChart" aria-label="Page views over time"></canvas></article>' +
      '<article class="panel chart-card"><canvas id="sessionsChart" aria-label="Sessions over time"></canvas></article>' +
      '<article class="panel chart-card"><canvas id="eventsChart" aria-label="Events over time"></canvas></article>' +
    '</section>' +

    '<section class="detail-grid">' +
      '<article class="panel"><div class="panel-title">Event usage</div>' +
        renderRows(report.events || [], ["event","weightedEvents","observedVisitors"], ["Event","Weighted events","Visitors"]) +
      '</article>' +
      '<article class="panel"><div class="panel-title">Top routes</div>' +
        renderRows(report.routes || [], ["route","views","observedVisitors"], ["Route","Views","Visitors"]) +
      '</article>' +
      '<article class="panel"><div class="panel-title">Top game-page views</div>' +
        renderRows(report.games || [], ["gameId","views","observedVisitors"], ["Game ID","Views","Visitors"]) +
      '</article>' +
      '<article class="panel"><div class="panel-title">Data notes</div><div class="notes">' +
        (report.notes || []).map(note => '<p>' + escapeHtml(note) + '</p>').join("") +
      '</div></article>' +
    '</section>';

  const customStart = document.getElementById("customStart");
  const customEnd = document.getElementById("customEnd");
  if (state.customStart) customStart.value = localInputValue(new Date(state.customStart));
  if (state.customEnd) customEnd.value = localInputValue(new Date(state.customEnd));

  drawLineChart(document.getElementById("visitorsChart"), report.trend || [], "observedVisitors", "Visitors");
  drawLineChart(document.getElementById("viewsChart"), report.trend || [], "pageViews", "Page views");
  drawLineChart(document.getElementById("sessionsChart"), report.trend || [], "observedSessions", "Sessions");
  drawLineChart(document.getElementById("eventsChart"), report.trend || [], "weightedEvents", "Events");

  document.querySelectorAll("[data-range]").forEach(button => {
    button.addEventListener("click", async () => {
      state.range = button.dataset.range;
      if (state.range !== "custom") {
        state.customStart = null;
        state.customEnd = null;
        await load();
      } else {
        render();
      }
    });
  });

  document.getElementById("applyCustom").addEventListener("click", async () => {
    const start = document.getElementById("customStart").value;
    const end = document.getElementById("customEnd").value;
    if (!start || !end) return;
    state.customStart = new Date(start).toISOString();
    state.customEnd = new Date(end).toISOString();
    state.range = "custom";
    await load();
  });

  document.getElementById("refresh").addEventListener("click", load);
}

function renderRows(rows, keys, headers) {
  if (!rows.length) return '<div class="empty">No data.</div>';

  return '<div class="table-wrap"><table><thead><tr>' +
    headers.map(header => '<th>' + escapeHtml(header) + '</th>').join("") +
    '</tr></thead><tbody>' +
    rows.map(row => '<tr>' +
      keys.map(key => '<td>' + escapeHtml(key === "route" || key === "event" || key === "gameId" ? row[key] : fmtNumber(row[key])) + '</td>').join("") +
    '</tr>').join("") +
    '</tbody></table></div>';
}

function localInputValue(date) {
  const pad = value => String(value).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) +
    "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

async function load() {
  const range = rangeForPreset(state.range);
  const start = toIsoMinute(range.start);
  const end = toIsoMinute(range.end);

  state.loading = true;
  render();

  const url = "/admin/api/analytics?start=" + encodeURIComponent(start) +
    "&end=" + encodeURIComponent(end);

  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store"
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Analytics request failed.");
    }

    state.report = await response.json();
    state.loading = false;
    render();
  } catch (error) {
    state.loading = false;
    app.innerHTML = '<div class="panel error"><strong>Analytics unavailable.</strong><p>' +
      escapeHtml(error instanceof Error ? error.message : "Unknown error") +
      '</p><button id="retry" class="refresh">Retry</button></div>';
    document.getElementById("retry")?.addEventListener("click", load);
  }
}

window.addEventListener("resize", () => {
  if (state.report && !state.loading) render();
});

load();
