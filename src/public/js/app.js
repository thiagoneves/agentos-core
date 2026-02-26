/* global io */

// ─── DOM References ───
var socket = io();
var grid = document.getElementById('sessions-grid');
var connDot = document.getElementById('conn-dot');
var connText = document.getElementById('conn-text');

// ─── Socket Events ───
socket.on('connect', function () {
  connDot.className = 'status-dot online';
  connText.textContent = 'Live';
  fetchAll();
});

socket.on('disconnect', function () {
  connDot.className = 'status-dot offline';
  connText.textContent = 'Disconnected';
});

socket.on('sessions_update', function (sessions) {
  renderSessions(sessions);
  computeMetricsFromSessions(sessions);
});

// ─── Data Fetching ───
function fetchAll() {
  fetch('/api/sessions')
    .then(function (r) { return r.json(); })
    .then(function (sessions) {
      renderSessions(sessions);
      computeMetricsFromSessions(sessions);
    })
    .catch(function () {});

  fetch('/api/metrics')
    .then(function (r) { return r.json(); })
    .then(function (m) { renderMetrics(m); })
    .catch(function () {});
}

// ─── Metrics Computation ───
function computeMetricsFromSessions(sessions) {
  var totalTokens = 0, totalCost = 0, active = 0;
  var agentMap = {};

  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    totalTokens += s.tokens || 0;
    totalCost += s.costUsd || 0;
    if (s.status === 'running') active++;

    var events = s.events || [];
    for (var j = 0; j < events.length; j++) {
      var ev = events[j];
      var ag = (ev.data && ev.data.agent) || ev.agent || 'unknown';
      var t = (ev.data && ev.data.tokens) || 0;
      var c = (ev.data && ev.data.cost) || 0;
      if (t > 0 || c > 0) {
        if (!agentMap[ag]) agentMap[ag] = { tokens: 0, cost: 0, sessions: 0 };
        agentMap[ag].tokens += t;
        agentMap[ag].cost += c;
      }
    }

    var mainAgent = s.currentAgent || 'unknown';
    if (!agentMap[mainAgent]) agentMap[mainAgent] = { tokens: 0, cost: 0, sessions: 0 };
    agentMap[mainAgent].sessions++;
  }

  var breakdown = [];
  for (var name in agentMap) {
    breakdown.push({ agent: name, tokens: agentMap[name].tokens, cost: agentMap[name].cost, sessions: agentMap[name].sessions });
  }

  renderMetrics({
    totalSessions: sessions.length,
    activeSessions: active,
    totalTokens: totalTokens,
    totalCost: totalCost,
    agentBreakdown: breakdown,
  });
}

// ─── Formatters ───
function fmtTokens(n) {
  if (!n || n === 0) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toString();
}

function fmtCost(n) {
  if (!n || n === 0) return '$0.00';
  return '$' + n.toFixed(4);
}

function elapsed(startedAt) {
  if (!startedAt) return '-';
  var ms = Date.now() - new Date(startedAt).getTime();
  var secs = Math.floor(ms / 1000);
  if (secs < 0) return '-';
  if (secs < 60) return secs + 's';
  var mins = Math.floor(secs / 60);
  if (mins < 60) return mins + 'm ' + (secs % 60) + 's';
  var hrs = Math.floor(mins / 60);
  return hrs + 'h ' + (mins % 60) + 'm';
}

function formatTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDur(secs) {
  if (secs === null || secs === undefined) return '';
  if (secs < 60) return secs + 's';
  var m = Math.floor(secs / 60);
  return m + 'm ' + (secs % 60) + 's';
}

// ─── Phase Duration Extraction ───
function phaseDuration(events) {
  var phases = [];
  var starts = {};

  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (ev.type === 'PHASE_START') {
      starts[ev.phase || (ev.data && ev.data.name) || 'unknown'] = ev.timestamp;
    }
    if (ev.type === 'STEP_COMPLETE' && ev.data) {
      var name = ev.data.step || ev.data.name || 'unknown';
      var startTs = starts[name];
      var dur = null;
      if (startTs) {
        dur = Math.round((new Date(ev.timestamp).getTime() - new Date(startTs).getTime()) / 1000);
      }
      phases.push({ name: name, status: ev.data.status || 'completed', duration: dur });
    }
  }
  return phases;
}

// ─── Event Labels ───
function eventLabel(type) {
  var map = {
    'SESSION_START': 'Session started',
    'SESSION_RESUME': 'Resumed',
    'PHASE_START': 'Phase started',
    'PHASE_COMPLETE': 'Phase done',
    'PHASE_FAILED': 'Phase failed',
    'STEP_COMPLETE': 'Step done',
    'GATE_PAUSE': 'Awaiting approval',
    'SESSION_COMPLETE': 'Completed',
    'METRICS_UPDATE': 'Update',
  };
  return map[type] || type;
}

function eventClass(type) {
  if (type === 'PHASE_FAILED') return 'failed';
  if (type.indexOf('START') >= 0 || type === 'METRICS_UPDATE' || type === 'SESSION_RESUME') return 'start';
  if (type.indexOf('COMPLETE') >= 0) return 'complete';
  if (type.indexOf('GATE') >= 0 || type.indexOf('PAUSE') >= 0) return 'pause';
  return '';
}

// ─── Render: Metrics ───
function renderMetrics(m) {
  document.getElementById('s-sessions').textContent = m.totalSessions || 0;
  document.getElementById('s-tokens').textContent = fmtTokens(m.totalTokens);
  document.getElementById('s-cost').textContent = fmtCost(m.totalCost);
  document.getElementById('s-active').textContent = m.activeSessions || 0;

  var breakdown = m.agentBreakdown || [];
  var section = document.getElementById('agent-panel');
  var tbody = document.getElementById('agent-tbody');

  if (breakdown.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  var maxTokens = 1;
  for (var i = 0; i < breakdown.length; i++) {
    if (breakdown[i].tokens > maxTokens) maxTokens = breakdown[i].tokens;
  }

  var html = '';
  for (var j = 0; j < breakdown.length; j++) {
    var a = breakdown[j];
    var pct = maxTokens > 0 ? Math.round((a.tokens / maxTokens) * 100) : 0;
    html += '<tr>';
    html += '<td class="agent-name">@' + a.agent + '</td>';
    html += '<td class="mono">' + fmtTokens(a.tokens) + '</td>';
    html += '<td class="mono">' + fmtCost(a.cost) + '</td>';
    html += '<td class="mono">' + (a.sessions || 0) + '</td>';
    html += '<td><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div></td>';
    html += '</tr>';
  }
  tbody.innerHTML = html;
}

// ─── Render: Sessions ───
function renderSessions(sessions) {
  if (!sessions || sessions.length === 0) {
    grid.innerHTML = '<div class="empty"><p>No sessions yet</p><p>Start a workflow with <code>aos run &lt;workflow&gt;</code></p></div>';
    return;
  }

  sessions.sort(function (a, b) {
    if (a.status === 'running' && b.status !== 'running') return -1;
    if (b.status === 'running' && a.status !== 'running') return 1;
    return new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime();
  });

  grid.innerHTML = sessions.map(function (s) {
    var mission = s.activeMission || s.workflowId || 'Unknown';
    var agent = s.currentAgent || '-';
    var phase = s.currentPhase || s.currentStep || '-';
    var status = s.status || 'unknown';
    var events = s.events || [];
    var startedAt = s.startedAt || (events[0] && events[0].timestamp);

    var phaseStarts = events.filter(function (e) { return e.type === 'PHASE_START'; }).length;
    var phaseCompletes = events.filter(function (e) {
      return e.type === 'STEP_COMPLETE' && e.data && e.data.status === 'completed';
    }).length;
    var progress = status === 'completed' ? 100 : (phaseStarts > 0 ? Math.min(90, Math.round((phaseCompletes / phaseStarts) * 100)) : 10);

    var phases = phaseDuration(events);

    var h = '<div class="card">';
    h += '<div class="card-header">';
    h += '<h3>' + esc(mission) + '</h3>';
    h += '<span class="badge ' + status + '">' + status + '</span>';
    h += '</div>';

    h += '<div class="meta-row">';
    h += '<span class="meta-item">Agent <strong>@' + esc(agent) + '</strong></span>';
    h += '<span class="meta-item">Phase <strong>' + esc(phase) + '</strong></span>';
    h += '<span class="meta-item">Elapsed <strong>' + elapsed(startedAt) + '</strong></span>';
    if (s.tokens > 0) h += '<span class="meta-item">Tokens <strong>' + fmtTokens(s.tokens) + '</strong></span>';
    if (s.costUsd > 0) h += '<span class="meta-item">Cost <strong>' + fmtCost(s.costUsd) + '</strong></span>';
    h += '</div>';

    h += '<div class="progress-bar"><div class="progress-fill ' + status + '" style="width:' + progress + '%"></div></div>';

    if (phases.length > 0) {
      h += '<div class="phases">';
      for (var p = 0; p < phases.length; p++) {
        var cls = phases[p].status === 'completed' ? 'done' : 'active';
        h += '<span class="phase-chip ' + cls + '">';
        h += esc(phases[p].name);
        if (phases[p].duration !== null) h += ' <span class="phase-dur">' + fmtDur(phases[p].duration) + '</span>';
        h += '</span>';
      }
      h += '</div>';
    }

    h += '<div class="stats-row">';
    h += '<span>' + phaseCompletes + '/' + phaseStarts + ' phases</span>';
    h += '<span>' + events.length + ' events</span>';
    h += '</div>';

    h += '<div class="timeline">';
    var rev = events.slice().reverse();
    for (var i = 0; i < rev.length; i++) {
      var e = rev[i];
      var detail = '';
      if (e.phase) detail = e.phase;
      else if (e.data && e.data.agent && e.data.agent !== 'unknown') detail = '@' + e.data.agent;
      else if (e.data && e.data.name) detail = e.data.name;
      else if (e.data && e.data.step) detail = e.data.step;
      else if (e.data && e.data.workflowId) detail = e.data.workflowId;

      h += '<div class="tl-item">';
      h += '<span class="time">' + formatTime(e.timestamp) + '</span>';
      h += '<span class="type ' + eventClass(e.type) + '">' + eventLabel(e.type) + '</span>';
      h += '<span class="detail">' + esc(detail) + '</span>';
      h += '</div>';
    }
    h += '</div>';

    h += '</div>';
    return h;
  }).join('');
}

// ─── Utility ───
function esc(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Polling ───
setInterval(fetchAll, 5000);
