import {
  computeHistoricalMilestones,
  detectReturnAlerts,
  detectNewPeak,
  mergePeakObservations
} from "./return-loops-core.mjs";

const API = String(window.__BOBAKS_API__ || "").replace(/\/$/, "");
const WATCHLIST_KEY = "bobaks.watchlist";
const ALERT_PREFS_KEY = "bobaks.return.alert-preferences";
const OBSERVED_KEY = "bobaks.return.observations";
const PEAKS_KEY = "bobaks.return.peaks";
const ALERT_FEED_KEY = "bobaks.return.alert-feed";
const MAX_ALERTS = 30;
const CHECK_LIMIT_HOME = 8;

const DEFAULT_PREFS = Object.freeze({
  top10: true,
  newPeak: true,
  bigMove: true
});

const esc = value => String(value ?? "").replace(/[&<>"]/g, char => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;"
}[char]));

const fmt = value => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)).toLocaleString() : "0";
};

const fmtDate = value => {
  const text = String(value ?? "");
  return text ? text.slice(0, 10) : "Not available";
};

function readJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "");
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function savedIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || "[]");
    return Array.isArray(parsed)
      ? [...new Set(parsed.map(String).filter(id => /^\d+$/.test(id)))].slice(0, 25)
      : [];
  } catch {
    return [];
  }
}

function alertPrefs() {
  const saved = readJson(ALERT_PREFS_KEY, {});
  return saved && typeof saved === "object" ? saved : {};
}

function prefsFor(gameId) {
  const all = alertPrefs();
  return { ...DEFAULT_PREFS, ...(all[String(gameId)] || {}) };
}

function setPrefs(gameId, prefs) {
  const all = alertPrefs();
  all[String(gameId)] = {
    top10: Boolean(prefs.top10),
    newPeak: Boolean(prefs.newPeak),
    bigMove: Boolean(prefs.bigMove)
  };
  writeJson(ALERT_PREFS_KEY, all);
}

function observations() {
  return readJson(OBSERVED_KEY, {});
}

function setObservation(gameId, value) {
  const all = observations();
  all[String(gameId)] = value;
  writeJson(OBSERVED_KEY, all);
}

function alertFeed() {
  const value = readJson(ALERT_FEED_KEY, []);
  return Array.isArray(value) ? value.slice(0, MAX_ALERTS) : [];
}

function addAlerts(gameId, name, alerts) {
  if (!alerts.length) return;
  const feed = alertFeed();
  const now = new Date().toISOString();
  const next = [
    ...alerts.map(alert => ({
      id: String(gameId) + ":" + alert.type + ":" + now,
      gameId: String(gameId),
      name: String(name || "Saved game"),
      type: alert.type,
      message: alert.message,
      at: now
    })),
    ...feed
  ].slice(0, MAX_ALERTS);
  writeJson(ALERT_FEED_KEY, next);
}

function api(path) {
  if (!API) return Promise.reject(new Error("API origin unavailable"));
  return fetch(API + path, { headers: { accept: "application/json" } }).then(async response => {
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  });
}

async function observeGameData(game) {
  const id = String(game?.gameId ?? game?.id ?? "");
  if (!/^\d+$/.test(id)) return [];
  const current = {
    rank: Number(game?.rankings?.live?.rank) || null,
    players: Number(game?.currentPlayers ?? game?.rankings?.live?.score ?? 0) || 0,
    peakPlayers: Number(game?.peak ?? game?.peakPlayers ?? 0) || 0,
    peakAt: game?.peakAt ? String(game.peakAt) : null
  };
  const previous = observations()[id] || null;
  const alerts = detectReturnAlerts({
    previous,
    current,
    preferences: prefsFor(id)
  });
  if (alerts.length) addAlerts(id, game?.name, alerts);
  setObservation(id, { ...current, observedAt: new Date().toISOString() });
  return alerts;
}

async function observeSavedGames(ids, limit) {
  const selected = ids.slice(0, limit);
  await Promise.allSettled(selected.map(async id => {
    try {
      const [gameResponse, peakResponse] = await Promise.all([
        api("/api/games/" + encodeURIComponent(id)),
        prefsFor(id).newPeak
          ? api("/api/games/" + encodeURIComponent(id) + "/peak")
          : Promise.resolve({ data: null })
      ]);
      const game = {
        ...(gameResponse.data || {}),
        gameId: id,
        peak: Number(peakResponse.data?.peakPlayers || 0),
        peakAt: peakResponse.data?.peakAt || null
      };
      await observeGameData(game);
    } catch {}
  }));
}

function injectStyle() {
  if (document.getElementById("bobaks-return-loops-style")) return;
  const style = document.createElement("style");
  style.id = "bobaks-return-loops-style";
  style.textContent = `
.return-hub{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}
.return-card{border:1px solid var(--line);border-radius:16px;background:var(--surface);padding:17px;min-width:0;box-shadow:0 10px 30px rgba(0,0,0,.12)}
.return-card h3{margin:5px 0 4px;font-family:Manrope,Inter,sans-serif;font-size:15px}
.return-card p{margin:0;color:var(--muted);font-size:10px;line-height:1.55}
.return-label{color:#A8DFFF;font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
.return-value{margin-top:9px;font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.return-meta{margin-top:4px;color:var(--muted-2);font-size:9px}
.return-link{display:inline-flex;margin-top:12px;color:#A8DFFF;font-size:10px;font-weight:800}
.return-list{margin:10px 0 0;padding:0;list-style:none;display:grid;gap:7px}
.return-list li{display:flex;justify-content:space-between;gap:8px;color:#DDE8F5;font-size:10px}
.return-list li span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.return-positive{color:var(--positive)}
.return-empty{color:var(--muted-2)!important}
.return-wide{grid-column:span 2}
.return-alert-panel{margin-top:8px;padding:11px;border:1px solid var(--line-strong);border-radius:12px;background:var(--surface-2)}
.return-alert-panel label{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:10px;margin:7px 0}
.return-alert-panel input{accent-color:var(--accent)}
.return-alert-note{margin:8px 0 0;color:var(--muted-2);font-size:9px;line-height:1.45}
.return-milestones{margin-top:14px}
.return-milestone-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:12px}
.return-milestone{padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
.return-milestone span{display:block;color:var(--muted-2);font-size:8px;text-transform:uppercase;letter-spacing:.1em;font-weight:800}
.return-milestone strong{display:block;margin-top:5px;font-size:12px}
.return-alerts{margin:0 0 14px}
.return-alert-item{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)}
.return-alert-item:last-child{border-bottom:0}
.return-alert-item b{display:block;font-size:11px}
.return-alert-item small{display:block;margin-top:3px;color:var(--muted);font-size:9px}
.return-alert-item time{color:var(--muted-2);font-size:8px;white-space:nowrap}
@media(max-width:980px){.return-hub{grid-template-columns:repeat(2,minmax(0,1fr))}.return-wide{grid-column:span 2}.return-milestone-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:620px){.return-hub{grid-template-columns:1fr}.return-wide{grid-column:auto}.return-card{padding:15px}.return-milestone-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
  document.head.appendChild(style);
}

async function decorateHome() {
  if (document.querySelector("[data-return-hub]")) return;
  const host = document.querySelector(".dashboard");
  if (!host || !document.querySelector(".moving-section")) return;

  const saved = savedIds();
  const [live, week] = await Promise.all([
    api("/api/social/feed?period=live").catch(() => null),
    api("/api/social/feed?period=week").catch(() => null)
  ]);

  await observeSavedGames(saved, CHECK_LIMIT_HOME);

  const liveRanking = live?.ranking?.items || [];
  const weekTrending = week?.trending?.items || [];
  const peakItems = live?.peaks?.items || [];
  const previousPeaks = readJson(PEAKS_KEY, {});
  const freshPeaks = peakItems.filter(item => {
    const id = String(item?.gameId ?? "");
    return /^\d+$/.test(id) && detectNewPeak(previousPeaks[id], item);
  });
  writeJson(PEAKS_KEY, mergePeakObservations(previousPeaks, peakItems));

  const top = liveRanking[0];
  const weeklyMover = weekTrending[0];
  const moverItems = weekTrending.slice(0, 3);

  const hub = document.createElement("section");
  hub.className = "return-hub";
  hub.dataset.returnHub = "1";
  hub.innerHTML =
    '<article class="return-card"><div class="return-label">DAILY RANKINGS</div>' +
      '<h3>' + esc(top?.name || "Live rankings") + '</h3>' +
      '<p>Today’s live ranking snapshot is ready to explore.</p>' +
      (top ? '<div class="return-value">#' + fmt(top.rank) + ' · ' + fmt(top.score) + ' players</div>' : '') +
      '<a class="return-link" href="/">Open live rankings →</a></article>' +
    '<article class="return-card"><div class="return-label">WEEKLY CHANGES</div>' +
      '<h3>' + esc(weeklyMover?.name || "This week") + '</h3>' +
      '<p>See which games are moving up in the weekly ranking.</p>' +
      (weeklyMover ? '<div class="return-value return-positive">▲ +' + fmt(weeklyMover.rankChange) + ' ranks</div>' : '<div class="return-meta">No upward mover yet.</div>') +
      '<a class="return-link" href="/rankings/weekly">Open weekly rankings →</a></article>' +
    '<article class="return-card return-wide"><div class="return-label">BIGGEST MOVERS</div>' +
      '<h3>Games worth checking</h3><ul class="return-list">' +
      (moverItems.length
        ? moverItems.map(item => '<li><span>' + esc(item.name) + '</span><b class="return-positive">▲ +' + fmt(item.rankChange) + '</b></li>').join("")
        : '<li><span class="return-empty">No major upward movement right now.</span></li>') +
      '</ul></article>' +
    '<article class="return-card return-wide"><div class="return-label">NEW PEAKS</div>' +
      '<h3>' + (freshPeaks.length ? fmt(freshPeaks.length) + ' new recorded peak' + (freshPeaks.length === 1 ? '' : 's') : 'Peak check') + '</h3>' +
      '<p>' + (freshPeaks.length
        ? 'New peak records detected since your last Bobaks visit.'
        : 'No new recorded peaks detected since your last Bobaks visit.') + '</p>' +
      (freshPeaks.length
        ? '<ul class="return-list">' + freshPeaks.slice(0, 3).map(item => '<li><span>' + esc(item.name) + '</span><b>' + fmt(item.peakPlayers) + '</b></li>').join("") + '</ul>'
        : '') +
      '<a class="return-link" href="/rankings/weekly">Keep exploring →</a></article>' +
    '<article class="return-card"><div class="return-label">WATCHLIST</div>' +
      '<h3>' + fmt(saved.length) + ' saved game' + (saved.length === 1 ? '' : 's') + '</h3>' +
      '<p>Return to games you are following on this device.</p>' +
      '<a class="return-link" href="/saved">Open watchlist →</a></article>';

  host.parentElement.insertBefore(hub, host);
}

function ensureAlertButton() {
  const actions = document.querySelector(".actions-wide");
  const path = location.pathname.match(/^\/game\/(\d+)$/);
  if (!actions || !path || actions.querySelector("[data-return-alert]")) return;
  const button = document.createElement("button");
  button.className = "btn";
  button.type = "button";
  button.dataset.returnAlert = path[1];
  button.textContent = "Alerts";
  actions.appendChild(button);
}

function alertPanel(gameId) {
  const prefs = prefsFor(gameId);
  const panel = document.createElement("div");
  panel.className = "return-alert-panel";
  panel.dataset.returnAlertPanel = gameId;
  panel.innerHTML =
    '<label><input type="checkbox" data-alert-pref="top10" ' + (prefs.top10 ? "checked" : "") + '> Notify when it enters Top 10</label>' +
    '<label><input type="checkbox" data-alert-pref="newPeak" ' + (prefs.newPeak ? "checked" : "") + '> Notify when it sets a new peak</label>' +
    '<label><input type="checkbox" data-alert-pref="bigMove" ' + (prefs.bigMove ? "checked" : "") + '> Notify when it jumps 5+ ranks</label>' +
    '<p class="return-alert-note">Alerts are checked when you revisit Bobaks. They stay on this device and do not require an account.</p>';
  return panel;
}

function ensureAlertPanel() {
  document.querySelectorAll("[data-return-alert]").forEach(button => {
    if (button.dataset.boundReturnAlert) return;
    button.dataset.boundReturnAlert = "1";
    button.addEventListener("click", event => {
      event.stopPropagation();
      const id = button.dataset.returnAlert;
      const existing = document.querySelector("[data-return-alert-panel='" + id + "']");
      if (existing) {
        existing.remove();
        return;
      }
      document.querySelectorAll("[data-return-alert-panel]").forEach(panel => panel.remove());
      button.insertAdjacentElement("afterend", alertPanel(id));
    });
  });
}

function ensureSavedAlertButtons() {
  if (location.pathname !== "/saved") return;
  document.querySelectorAll(".rows .row").forEach(row => {
    const saveButton = row.querySelector("[data-save]");
    const gameButton = row.querySelector("[data-game]");
    const actions = row.querySelector(".actions");
    if (!saveButton || !gameButton || !actions || actions.querySelector("[data-return-alert]")) return;
    const id = saveButton.dataset.save || gameButton.dataset.game;
    const button = document.createElement("button");
    button.className = "mini";
    button.type = "button";
    button.dataset.returnAlert = id;
    button.textContent = "Alerts";
    actions.appendChild(button);
  });
}

function ensureMilestones() {
  if (!location.pathname.match(/^\/game\/\d+$/)) return;
  const app = document.querySelector("#app");
  const game = window.__BOBAKS_SELECTED_GAME__;
  if (!app || !game || game.loading || app.querySelector("[data-return-milestones]")) return;

  const data = computeHistoricalMilestones(
    Array.isArray(game.history) ? game.history : [],
    Array.isArray(game.rankHistory) ? game.rankHistory : [],
    { peakPlayers: game.peak, peakAt: game.peakAt }
  );

  const panel = document.createElement("section");
  panel.className = "panel return-milestones";
  panel.dataset.returnMilestones = "1";
  panel.innerHTML =
    '<div class="eyebrow">RETURN LOOP</div><h2>Historical Milestones</h2>' +
    '<p>Milestones are calculated from the history Bobaks has collected for this game.</p>' +
    '<div class="return-milestone-grid">' +
      '<div class="return-milestone"><span>First recorded</span><strong>' + esc(fmtDate(data.firstRecordedAt)) + '</strong></div>' +
      '<div class="return-milestone"><span>Recorded peak</span><strong>' + fmt(data.peakPlayers) + '</strong></div>' +
      '<div class="return-milestone"><span>Best rank</span><strong>' + (data.bestRank ? "#" + fmt(data.bestRank) : "Not ranked") + '</strong></div>' +
      '<div class="return-milestone"><span>First Top 10</span><strong>' + esc(fmtDate(data.firstTop10At)) + '</strong></div>' +
      '<div class="return-milestone"><span>Historical days</span><strong>' + fmt(data.historicalDays) + '</strong></div>' +
    '</div>';
  const panels = [...app.querySelectorAll(".panel")];
  const rankHistory = panels.find(panel => /Rank History/i.test(panel.querySelector("h2")?.textContent || ""));
  if (rankHistory) rankHistory.insertAdjacentElement("afterend", panel);
  else app.appendChild(panel);
}

function ensureSavedAlertsSummary() {
  if (location.pathname !== "/saved" || document.querySelector("[data-return-alerts-summary]")) return;
  const host = document.querySelector(".main-card");
  if (!host) return;
  const feed = alertFeed();
  const panel = document.createElement("section");
  panel.className = "panel return-alerts";
  panel.dataset.returnAlertsSummary = "1";
  panel.innerHTML =
    '<div class="eyebrow">GAME ALERTS</div><h2>Recent alerts</h2>' +
    (feed.length
      ? feed.slice(0, 8).map(item =>
          '<div class="return-alert-item"><div><b>' + esc(item.name) + '</b><small>' + esc(item.message) + '</small></div><time>' + esc(fmtDate(item.at)) + '</time></div>'
        ).join("")
      : '<p>No saved-game alerts yet. Alert checks run when you revisit Bobaks.</p>');
  host.parentElement.insertBefore(panel, host);
}

async function decorate() {
  injectStyle();
  if (location.pathname === "/" || location.pathname.startsWith("/rankings/") ) {
    await decorateHome();
  }
  ensureAlertButton();
  ensureAlertPanel();
  ensureSavedAlertButtons();
  ensureSavedAlertsSummary();
  ensureMilestones();

  const game = window.__BOBAKS_SELECTED_GAME__;
  if (game && !game.loading) {
    await observeGameData(game);
  }
}

let scheduled = false;
const schedule = () => {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(async () => {
    scheduled = false;
    try { await decorate(); } catch {}
  });
};

new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true
});

schedule();
