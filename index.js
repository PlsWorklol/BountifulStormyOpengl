const http = require("http");
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");

const port = process.env.PORT || 3000;

// === ENHANCED CONFIGURATION ===
const config = {
  placeId: "10627207685", // Your Roblox Place ID
  discordWebhook: "https://discord.com/api/webhooks/1382673360244441098/i7DgFwgmJIQ2Cz2QzjTrHqmJbCZJl9UqzyJljd7ryOuK6Qs-SuyoVNcC8lgYP1HMGOI1",
  checkInterval: 15000, // Every 15 seconds

  // Feature toggles
  features: {
    sendHourlyUpdates: true,
    sendDailySummary: true,
    enableLeaveNotifications: true,
    enablePlayerMilestones: true,
    enableVisitMilestones: true,
    enableStreakTracking: true,
    enableTrendAnalysis: true,
    enablePeakPrediction: true,
    enablePlayerBehaviorAnalysis: true,
    enableCompetitorTracking: false, // Track similar games
    enableAnomalyDetection: true,
    enableVIPAlerts: true, // Special alerts for VIP events
    enablePerformanceMetrics: true,
    enableDataPersistence: true,
    enableWebDashboard: true
  },

  // Thresholds
  thresholds: {
    minPlayersForNotification: 1,
    rapidGrowthThreshold: 5, // Players joining in rapid succession
    massExodusThreshold: 10, // Players leaving rapidly
    anomalyThreshold: 3, // Standard deviations for anomaly detection
    vipPlayerThreshold: 50, // Threshold for VIP alerts
    lagAlert: 30000 // Alert if API response time > 30s
  },

  // Milestones
  playerMilestones: [10, 25, 50, 100, 200, 500, 1000, 2000, 5000],
  visitMilestones: [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 5000000],

  // Advanced features
  competitorPlaceIds: [], // Add competitor place IDs for comparison
  dataRetentionDays: 30,
  reportSchedule: {
    weekly: true,
    monthly: true,
    quarterly: false
  }
};

// === ENHANCED DATA STRUCTURES ===
let gameState = {
  current: {},
  previous: {},
  history: [], // Last 24 hours of data points
  trends: {
    hourly: [],
    daily: [],
    weekly: []
  }
};

let analytics = {
  playerBehavior: {
    averageSessionLength: 0,
    peakHours: new Map(),
    growthRate: 0,
    retentionRate: 0,
    bounceRate: 0
  },
  performance: {
    apiResponseTimes: [],
    uptime: 0,
    errorRate: 0,
    lastErrors: []
  },
  predictions: {
    nextPeak: null,
    dailyForecast: [],
    weeklyForecast: []
  }
};

let extendedStats = {
  dailyStats: {
    peakPlayers: 0,
    lowestPlayers: Infinity,
    totalJoins: 0,
    totalLeaves: 0,
    startTime: new Date(),
    visitCount: 0,
    uniqueEvents: 0,
    rapidGrowthEvents: 0,
    massExodusEvents: 0
  },

  streakData: {
    emptyStreak: 0,
    activeStreak: 0,
    longestEmptyStreak: 0,
    longestActiveStreak: 0,
    currentStreakType: 'unknown'
  },

  anomalies: [],
  events: [],
  competitors: new Map()
};

let systemMetrics = {
  startTime: new Date(),
  totalChecks: 0,
  successfulChecks: 0,
  consecutiveErrors: 0,
  maxConsecutiveErrors: 5,
  lastApiCall: null,
  averageResponseTime: 0
};

// === UTILITY FUNCTIONS ===
function nowISO() { return new Date().toISOString(); }
function nowLocale() { return new Date().toLocaleString(); }

function calculateAverage(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function calculateStandardDeviation(arr, avg = null) {
  if (!arr.length) return 0;
  avg = avg || calculateAverage(arr);
  const squareDiffs = arr.map(value => Math.pow(value - avg, 2));
  return Math.sqrt(calculateAverage(squareDiffs));
}

function formatDuration(ms) {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

function generateChart(data, title) {
  // Simple ASCII chart for Discord
  const max = Math.max(...data);
  const bars = data.map(val => '█'.repeat(Math.round((val / max) * 10)));
  return `\`\`\`\n${title}\n${bars.join('\n')}\n\`\`\``;
}

// === DATA PERSISTENCE ===
async function saveData() {
  if (!config.features.enableDataPersistence) return;

  try {
    const dataToSave = {
      gameState,
      analytics,
      extendedStats,
      systemMetrics,
      timestamp: nowISO()
    };

    await fs.writeFile('tracker_data.json', JSON.stringify(dataToSave, null, 2));
  } catch (error) {
    console.error('❌ Failed to save data:', error.message);
  }
}

async function loadData() {
  if (!config.features.enableDataPersistence) return;

  try {
    const data = await fs.readFile('tracker_data.json', 'utf8');
    const parsed = JSON.parse(data);

    gameState = parsed.gameState || gameState;
    analytics = parsed.analytics || analytics;
    extendedStats = parsed.extendedStats || extendedStats;

    console.log('✅ Historical data loaded');
  } catch (error) {
    console.log('ℹ️ No previous data found, starting fresh');
  }
}

// === API FUNCTIONS ===
async function getUniverseId() {
  const startTime = Date.now();
  const url = `https://apis.roproxy.com/universes/v1/places/${config.placeId}/universe`;
  const res = await axios.get(url);
  systemMetrics.lastApiCall = Date.now() - startTime;
  return res.data.universeId;
}

async function getGameData(universeId) {
  const startTime = Date.now();
  const url = `https://games.roproxy.com/v1/games?universeIds=${universeId}`;
  const res = await axios.get(url);

  const responseTime = Date.now() - startTime;
  analytics.performance.apiResponseTimes.push(responseTime);

  // Keep only last 100 response times
  if (analytics.performance.apiResponseTimes.length > 100) {
    analytics.performance.apiResponseTimes.shift();
  }

  const game = res.data.data[0];
  return {
    name: game.name,
    playing: game.playing,
    visits: game.visits,
    maxPlayers: game.maxPlayers,
    created: game.created,
    updated: game.updated,
    rating: game.rating || 0,
    genre: game.genre || "Unknown",
    timestamp: nowISO(),
    responseTime
  };
}

async function getCompetitorData() {
  if (!config.features.enableCompetitorTracking || !config.competitorPlaceIds.length) return;

  // Implementation for competitor tracking would go here
  // This is a placeholder for the structure
}

// === DISCORD FUNCTIONS ===
async function postToDiscord(embed) {
  try {
    await axios.post(config.discordWebhook, {
      username: "🎮 Advanced Roblox Tracker",
      embeds: [embed]
    });
  } catch (error) {
    console.error("❌ Discord webhook failed:", error.message);
    analytics.performance.lastErrors.push({
      type: 'discord',
      message: error.message,
      timestamp: nowISO()
    });
  }
}

// === ANALYSIS FUNCTIONS ===
function detectAnomaly(currentValue, historicalData) {
  if (!config.features.enableAnomalyDetection || historicalData.length < 10) return false;

  const avg = calculateAverage(historicalData);
  const stdDev = calculateStandardDeviation(historicalData, avg);
  const threshold = config.thresholds.anomalyThreshold;

  return Math.abs(currentValue - avg) > (threshold * stdDev);
}

function analyzeTrends() {
  if (!config.features.enableTrendAnalysis || gameState.history.length < 5) return;

  const recent = gameState.history.slice(-5).map(h => h.playing);
  const trend = recent[recent.length - 1] - recent[0];
  const avgGrowth = trend / recent.length;

  analytics.playerBehavior.growthRate = avgGrowth;

  // Detect rapid changes
  let rapidGrowth = 0;
  let rapidDecline = 0;

  for (let i = 1; i < recent.length; i++) {
    const change = recent[i] - recent[i-1];
    if (change >= config.thresholds.rapidGrowthThreshold) rapidGrowth++;
    if (change <= -config.thresholds.massExodusThreshold) rapidDecline++;
  }

  return { trend, avgGrowth, rapidGrowth, rapidDecline };
}

function predictNextPeak() {
  if (!config.features.enablePeakPrediction || gameState.history.length < 20) return null;

  // Simple pattern recognition for peak times
  const hourlyPattern = new Map();

  gameState.history.forEach(entry => {
    const hour = new Date(entry.timestamp).getHours();
    if (!hourlyPattern.has(hour)) hourlyPattern.set(hour, []);
    hourlyPattern.get(hour).push(entry.playing);
  });

  // Find hour with highest average players
  let peakHour = 0;
  let peakAvg = 0;

  hourlyPattern.forEach((players, hour) => {
    const avg = calculateAverage(players);
    if (avg > peakAvg) {
      peakAvg = avg;
      peakHour = hour;
    }
  });

  analytics.predictions.nextPeak = { hour: peakHour, expectedPlayers: Math.round(peakAvg) };
}

// === NOTIFICATION FUNCTIONS ===
async function sendPlayerJoinAlert(data) {
  extendedStats.dailyStats.totalJoins++;

  const embed = {
    title: "🎮 Players Joined!",
    description: `**${data.name}** now has **${data.playing}** players (+${data.playing - gameState.previous.playing})`,
    color: 0x00ff00,
    fields: [
      { name: "👥 Online", value: `${data.playing}/${data.maxPlayers}`, inline: true },
      { name: "👀 Visits", value: data.visits.toLocaleString(), inline: true },
      { name: "🕓 Time", value: nowLocale(), inline: true }
    ],
    footer: { text: "Join Alert • Response: " + data.responseTime + "ms" },
    timestamp: nowISO()
  };

  // Add trend analysis
  const trendData = analyzeTrends();
  if (trendData && trendData.avgGrowth > 1) {
    embed.fields.push({
      name: "📈 Growth Trend",
      value: `+${trendData.avgGrowth.toFixed(1)} players/check`,
      inline: true
    });
  }

  // Add streak info
  if (config.features.enableStreakTracking && extendedStats.streakData.activeStreak > 12) {
    embed.fields.push({
      name: "🔥 Active Streak",
      value: formatDuration(extendedStats.streakData.activeStreak * config.checkInterval),
      inline: true
    });
  }

  await postToDiscord(embed);
}

async function sendPlayerLeaveAlert(data) {
  if (!config.features.enableLeaveNotifications) return;

  extendedStats.dailyStats.totalLeaves++;
  const playersLeft = gameState.previous.playing - data.playing;

  const embed = {
    title: "👋 Players Left",
    description: `**${data.name}** now has **${data.playing}** players (-${playersLeft})`,
    color: playersLeft >= config.thresholds.massExodusThreshold ? 0xff6b35 : 0xff9999,
    fields: [
      { name: "👥 Online", value: `${data.playing}`, inline: true },
      { name: "📉 Left", value: `${playersLeft}`, inline: true },
      { name: "🕓 Time", value: nowLocale(), inline: true }
    ],
    footer: { text: "Leave Alert" },
    timestamp: nowISO()
  };

  // Mass exodus warning
  if (playersLeft >= config.thresholds.massExodusThreshold) {
    embed.title = "⚠️ Mass Exodus Detected!";
    embed.fields.push({
      name: "🚨 Alert Level",
      value: "HIGH - Multiple players left rapidly",
      inline: false
    });
    extendedStats.dailyStats.massExodusEvents++;
  }

  await postToDiscord(embed);
}

async function sendAnomalyAlert(data, type) {
  if (!config.features.enableAnomalyDetection) return;

  const embed = {
    title: "🔍 Anomaly Detected",
    description: `Unusual ${type} detected for **${data.name}**`,
    color: 0xff9500,
    fields: [
      { name: "📊 Current Value", value: `${data.playing} players`, inline: true },
      { name: "📈 Expected Range", value: "Based on historical data", inline: true },
      { name: "🕓 Time", value: nowLocale(), inline: true }
    ],
    footer: { text: "Anomaly Detection System" },
    timestamp: nowISO()
  };

  extendedStats.anomalies.push({
    type,
    value: data.playing,
    timestamp: nowISO()
  });

  await postToDiscord(embed);
}

async function sendVIPAlert(data) {
  if (!config.features.enableVIPAlerts || data.playing < config.thresholds.vipPlayerThreshold) return;

  const embed = {
    title: "⭐ VIP Event Alert!",
    description: `**${data.name}** has reached VIP status with **${data.playing}** players!`,
    color: 0xffd700,
    fields: [
      { name: "👑 VIP Threshold", value: `${config.thresholds.vipPlayerThreshold}+`, inline: true },
      { name: "👥 Current Players", value: `${data.playing}`, inline: true },
      { name: "🎯 Capacity", value: `${Math.round((data.playing/data.maxPlayers)*100)}%`, inline: true }
    ],
    footer: { text: "VIP Event System" },
    timestamp: nowISO()
  };

  await postToDiscord(embed);
}

async function sendAdvancedHourlyUpdate(data) {
  if (!config.features.sendHourlyUpdates) return;

  const avgResponseTime = calculateAverage(analytics.performance.apiResponseTimes);
  const uptime = Date.now() - systemMetrics.startTime;
  const successRate = systemMetrics.totalChecks > 0 ? 
    ((systemMetrics.successfulChecks / systemMetrics.totalChecks) * 100).toFixed(1) : 0;

  const embed = {
    title: "📊 Advanced Hourly Report",
    description: `**${data.name}** - Comprehensive Status`,
    color: 0x3498db,
    fields: [
      { name: "👥 Current Players", value: `${data.playing}/${data.maxPlayers}`, inline: true },
      { name: "👀 Total Visits", value: data.visits.toLocaleString(), inline: true },
      { name: "⭐ Rating", value: `${Math.round(data.rating)}%`, inline: true },
      { name: "🏆 Today's Peak", value: `${extendedStats.dailyStats.peakPlayers}`, inline: true },
      { name: "📈 Activity", value: `${extendedStats.dailyStats.totalJoins}J/${extendedStats.dailyStats.totalLeaves}L`, inline: true },
      { name: "⚡ Performance", value: `${avgResponseTime.toFixed(0)}ms avg`, inline: true },
      { name: "🎯 Success Rate", value: `${successRate}%`, inline: true },
      { name: "⏱️ Uptime", value: formatDuration(uptime), inline: true },
      { name: "🔍 Anomalies", value: `${extendedStats.anomalies.length}`, inline: true }
    ],
    footer: { text: "Advanced Hourly Update" },
    timestamp: nowISO()
  };

  // Add prediction if available
  if (analytics.predictions.nextPeak) {
    embed.fields.push({
      name: "🔮 Next Peak Prediction",
      value: `${analytics.predictions.nextPeak.expectedPlayers} players at ${analytics.predictions.nextPeak.hour}:00`,
      inline: false
    });
  }

  await postToDiscord(embed);
}

async function sendDailySummary(data) {
  if (!config.features.sendDailySummary) return;

  const uptime = Date.now() - extendedStats.dailyStats.startTime;
  const totalEvents = extendedStats.dailyStats.totalJoins + extendedStats.dailyStats.totalLeaves;

  const embed = {
    title: "📆 Advanced Daily Summary",
    description: `Complete daily analysis for **${data.name}**`,
    color: 0xf1c40f,
    fields: [
      { name: "👥 Final Players", value: `${data.playing}`, inline: true },
      { name: "🏆 Peak Players", value: `${extendedStats.dailyStats.peakPlayers}`, inline: true },
      { name: "📉 Lowest Count", value: `${extendedStats.dailyStats.lowestPlayers === Infinity ? 0 : extendedStats.dailyStats.lowestPlayers}`, inline: true },
      { name: "📊 Total Activity", value: `${totalEvents} events`, inline: true },
      { name: "🔥 Longest Streaks", value: `Active: ${formatDuration(extendedStats.streakData.longestActiveStreak * config.checkInterval)}`, inline: true },
      { name: "⚡ Avg Response", value: `${calculateAverage(analytics.performance.apiResponseTimes).toFixed(0)}ms`, inline: true },
      { name: "🚨 Special Events", value: `${extendedStats.dailyStats.rapidGrowthEvents} growth spikes\n${extendedStats.dailyStats.massExodusEvents} mass exits`, inline: false }
    ],
    footer: { text: "Daily Summary • Tracking: " + formatDuration(uptime) },
    timestamp: nowISO()
  };

  await postToDiscord(embed);

  // Reset daily stats
  extendedStats.dailyStats = {
    peakPlayers: data.playing,
    lowestPlayers: data.playing,
    totalJoins: 0,
    totalLeaves: 0,
    startTime: new Date(),
    visitCount: data.visits,
    uniqueEvents: 0,
    rapidGrowthEvents: 0,
    massExodusEvents: 0
  };
}

// === WEB DASHBOARD ===
function createDashboardHTML() {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>Roblox Tracker Dashboard</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #1a1a1a; color: #fff; }
        .container { max-width: 1200px; margin: 0 auto; }
        .card { background: #2d2d2d; border-radius: 8px; padding: 20px; margin: 10px 0; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .metric { text-align: center; }
        .metric h3 { margin: 0; color: #4CAF50; }
        .metric .value { font-size: 2em; font-weight: bold; }
        .status-online { color: #4CAF50; }
        .status-offline { color: #f44336; }
        .refresh { position: fixed; top: 20px; right: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎮 Roblox Tracker Dashboard</h1>
        <button class="refresh" onclick="location.reload()">🔄 Refresh</button>

        <div class="grid">
            <div class="card metric">
                <h3>Current Players</h3>
                <div class="value" id="current-players">Loading...</div>
            </div>
            <div class="card metric">
                <h3>Peak Today</h3>
                <div class="value" id="peak-players">Loading...</div>
            </div>
            <div class="card metric">
                <h3>Total Visits</h3>
                <div class="value" id="total-visits">Loading...</div>
            </div>
            <div class="card metric">
                <h3>Uptime</h3>
                <div class="value" id="uptime">Loading...</div>
            </div>
        </div>

        <div class="card">
            <h3>System Status</h3>
            <p>Game: <span id="game-name">Loading...</span></p>
            <p>Status: <span id="status">Loading...</span></p>
            <p>Last Update: <span id="last-update">Loading...</span></p>
            <p>Response Time: <span id="response-time">Loading...</span></p>
        </div>
    </div>

    <script>
        async function updateDashboard() {
            try {
                const response = await fetch('/api/stats');
                const data = await response.json();

                document.getElementById('current-players').innerText = data.currentPlayers || 0;
                document.getElementById('peak-players').innerText = data.dailyStats.peakPlayers || 0;
                document.getElementById('total-visits').innerText = (data.gameName ? data.visits?.toLocaleString() : 'N/A') || 'N/A';
                document.getElementById('uptime').innerText = data.uptime || 'N/A';
                document.getElementById('game-name').innerText = data.gameName || 'Unknown';
                document.getElementById('status').innerHTML = data.currentPlayers > 0 ? 
                    '<span class="status-online">🟢 Active</span>' : 
                    '<span class="status-offline">🔴 Empty</span>';
                document.getElementById('last-update').innerText = new Date(data.lastUpdate).toLocaleString();
                document.getElementById('response-time').innerText = data.responseTime + 'ms';
            } catch (error) {
                console.error('Failed to update dashboard:', error);
            }
        }

        updateDashboard();
        setInterval(updateDashboard, 30000); // Update every 30 seconds
    </script>
</body>
</html>`;
}

// === HTTP SERVER ===
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  switch (url.pathname) {
    case "/":
    case "/dashboard":
      if (config.features.enableWebDashboard) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(createDashboardHTML());
      } else {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Roblox Tracker is running!");
      }
      break;

    case "/ping":
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      break;

    case "/api/stats":
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        currentPlayers: gameState.current.playing || 0,
        gameName: gameState.current.name || "Unknown",
        visits: gameState.current.visits || 0,
        maxPlayers: gameState.current.maxPlayers || 0,
        dailyStats: extendedStats.dailyStats,
        streakData: extendedStats.streakData,
        analytics: analytics,
        systemMetrics: systemMetrics,
        uptime: Math.floor((Date.now() - systemMetrics.startTime) / 1000 / 60) + " minutes",
        responseTime: systemMetrics.lastApiCall || 0,
        lastUpdate: gameState.current.timestamp || new Date().toISOString()
      }));
      break;

    case "/api/history":
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(gameState.history));
      break;

    default:
      res.writeHead(404);
      res.end("Not Found");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`🌐 Advanced server listening on port ${port}`);
  if (config.features.enableWebDashboard) {
    console.log(`📊 Dashboard available at http://localhost:${port}/dashboard`);
  }
});

// === MAIN TRACKING LOOP ===
async function main() {
  console.log("🚀 Starting Advanced Roblox Player Tracker...");

  // Load historical data
  await loadData();

  try {
    const universeId = await getUniverseId();
    const initialData = await getGameData(universeId);

    gameState.current = initialData;
    gameState.previous = initialData;
    extendedStats.dailyStats.peakPlayers = initialData.playing;
    extendedStats.dailyStats.lowestPlayers = initialData.playing;

    console.log(`🎮 Now tracking "${initialData.name}"`);
    console.log(`📊 Current: ${initialData.playing}/${initialData.maxPlayers} players`);
    console.log(`👀 Visits: ${initialData.visits.toLocaleString()}`);
    console.log(`⭐ Rating: ${Math.round(initialData.rating)}%`);

    // Send startup notification
    await postToDiscord({
      title: "🚀 Advanced Tracker Initialized",
      description: `Now monitoring **${initialData.name}** with enhanced features`,
      color: 0x2ecc71,
      fields: [
        { name: "👥 Current Players", value: `${initialData.playing}/${initialData.maxPlayers}`, inline: true },
        { name: "👀 Total Visits", value: initialData.visits.toLocaleString(), inline: true },
        { name: "⭐ Rating", value: `${Math.round(initialData.rating)}%`, inline: true },
        { name: "🔄 Check Interval", value: `${config.checkInterval/1000}s`, inline: true },
        { name: "🎯 Features", value: `${Object.values(config.features).filter(Boolean).length} enabled`, inline: true },
        { name: "📊 Dashboard", value: config.features.enableWebDashboard ? "Enabled" : "Disabled", inline: true }
      ],
      footer: { text: "Advanced Roblox Tracker v2.0" },
      timestamp: nowISO()
    });

    // Hourly reports
    setInterval(async () => {
      try {
        await sendAdvancedHourlyUpdate(gameState.current);
        await saveData(); // Periodic data backup

        // Daily summary at midnight
        const now = new Date();
        if (config.features.sendDailySummary && now.getHours() === 0 && now.getMinutes() < 10) {
          await sendDailySummary(gameState.current);
        }
      } catch (err) {
        console.error("❌ Hourly update failed:", err.message);
      }
    }, 60 * 60 * 1000);

    // Save data every 5 minutes
    if (config.features.enableDataPersistence) {
      setInterval(saveData, 5 * 60 * 1000);
    }

    // Main tracking loop
    setInterval(async () => {
      systemMetrics.totalChecks++;

      try {
        const currentData = await getGameData(universeId);
        const previousCount = gameState.current.playing || 0;
        const currentCount = currentData.playing;

        console.log(`🔄 Check: ${currentCount} players (was ${previousCount}) - ${nowLocale()}`);

        // Update game state
        gameState.previous = { ...gameState.current };
        gameState.current = currentData;

        // Add to history (keep last 24 hours = 5760 entries at 15s intervals)
        gameState.history.push({
          ...currentData,
          timestamp: nowISO()
        });

        if (gameState.history.length > 5760) {
          gameState.history.shift();
        }

        // Update daily stats
        if (currentCount > extendedStats.dailyStats.peakPlayers) {
          extendedStats.dailyStats.peakPlayers = currentCount;
        }
        if (currentCount < extendedStats.dailyStats.lowestPlayers) {
          extendedStats.dailyStats.lowestPlayers = currentCount;
        }

        // Update streak tracking
        if (config.features.enableStreakTracking) {
          if (currentCount === 0) {
            extendedStats.streakData.emptyStreak++;
            extendedStats.streakData.activeStreak = 0;
            extendedStats.streakData.currentStreakType = 'empty';
            if (extendedStats.streakData.emptyStreak > extendedStats.streakData.longestEmptyStreak) {
              extendedStats.streakData.longestEmptyStreak = extendedStats.streakData.emptyStreak;
            }
          } else {
            extendedStats.streakData.activeStreak++;
            extendedStats.streakData.emptyStreak = 0;
            extendedStats.streakData.currentStreakType = 'active';
            if (extendedStats.streakData.activeStreak > extendedStats.streakData.longestActiveStreak) {
              extendedStats.streakData.longestActiveStreak = extendedStats.streakData.activeStreak;
            }
          }
        }

        // Anomaly detection
        if (config.features.enableAnomalyDetection && gameState.history.length >= 20) {
          const historicalCounts = gameState.history.slice(-20).map(h => h.playing);
          if (detectAnomaly(currentCount, historicalCounts)) {
            await sendAnomalyAlert(currentData, 'player_count');
          }
        }

        // Trend analysis and predictions
        if (config.features.enableTrendAnalysis) {
          analyzeTrends();
        }
        if (config.features.enablePeakPrediction) {
          predictNextPeak();
        }

        // Player milestone checks
        if (config.features.enablePlayerMilestones) {
          for (let milestone of config.playerMilestones) {
            if (currentCount >= milestone && previousCount < milestone) {
              await postToDiscord({
                title: "🎉 Player Milestone Achieved!",
                description: `**${currentData.name}** has reached **${milestone}** concurrent players!`,
                color: 0xffd700,
                fields: [
                  { name: "🎯 Milestone", value: `${milestone} players`, inline: true },
                  { name: "👥 Current", value: `${currentCount}`, inline: true },
                  { name: "📈 Growth", value: `+${currentCount - previousCount}`, inline: true },
                  { name: "🕓 Achievement Time", value: nowLocale(), inline: true },
                  { name: "📊 Capacity", value: `${Math.round((currentCount/currentData.maxPlayers)*100)}%`, inline: true },
                  { name: "⏱️ Session", value: formatDuration(extendedStats.streakData.activeStreak * config.checkInterval), inline: true }
                ],
                footer: { text: "Player Milestone System" },
                timestamp: nowISO()
              });
              break;
            }
          }
        }

        // Visit milestone checks
        if (config.features.enableVisitMilestones && gameState.previous.visits) {
          for (let milestone of config.visitMilestones) {
            if (currentData.visits >= milestone && gameState.previous.visits < milestone) {
              await postToDiscord({
                title: "🏆 Visit Milestone Reached!",
                description: `**${currentData.name}** has achieved **${milestone.toLocaleString()}** total visits!`,
                color: 0x9b59b6,
                fields: [
                  { name: "🎯 Milestone", value: `${milestone.toLocaleString()} visits`, inline: true },
                  { name: "👀 Current Visits", value: currentData.visits.toLocaleString(), inline: true },
                  { name: "📈 Recent Growth", value: `+${(currentData.visits - gameState.previous.visits).toLocaleString()}`, inline: true },
                  { name: "👥 Players Now", value: `${currentCount}`, inline: true },
                  { name: "⭐ Rating", value: `${Math.round(currentData.rating)}%`, inline: true },
                  { name: "🎮 Genre", value: currentData.genre, inline: true }
                ],
                footer: { text: "Visit Milestone System" },
                timestamp: nowISO()
              });
              break;
            }
          }
        }

        // VIP alerts for high player counts
        if (config.features.enableVIPAlerts && 
            currentCount >= config.thresholds.vipPlayerThreshold && 
            previousCount < config.thresholds.vipPlayerThreshold) {
          await sendVIPAlert(currentData);
        }

        // Player change notifications
        const playerDifference = currentCount - previousCount;

        if (playerDifference > 0 && currentCount >= config.thresholds.minPlayersForNotification) {
          // Rapid growth detection
          if (playerDifference >= config.thresholds.rapidGrowthThreshold) {
            extendedStats.dailyStats.rapidGrowthEvents++;
            await postToDiscord({
              title: "🚀 Rapid Growth Detected!",
              description: `**${currentData.name}** gained **${playerDifference}** players in one check!`,
              color: 0x00ff88,
              fields: [
                { name: "⚡ Growth Rate", value: `+${playerDifference} players`, inline: true },
                { name: "👥 New Total", value: `${currentCount}`, inline: true },
                { name: "📊 Capacity", value: `${Math.round((currentCount/currentData.maxPlayers)*100)}%`, inline: true },
                { name: "🔥 Momentum", value: analyzeTrends()?.avgGrowth > 0 ? "Accelerating" : "Stabilizing", inline: true }
              ],
              footer: { text: "Rapid Growth Alert" },
              timestamp: nowISO()
            });
          } else {
            await sendPlayerJoinAlert(currentData);
          }
        } else if (playerDifference < 0) {
          await sendPlayerLeaveAlert(currentData);
        }

        // Performance monitoring
        if (config.features.enablePerformanceMetrics) {
          // Alert for slow API responses
          if (currentData.responseTime > config.thresholds.lagAlert) {
            await postToDiscord({
              title: "⚠️ Performance Alert",
              description: `API response time is unusually high: ${currentData.responseTime}ms`,
              color: 0xff9500,
              fields: [
                { name: "🐌 Response Time", value: `${currentData.responseTime}ms`, inline: true },
                { name: "📊 Average", value: `${calculateAverage(analytics.performance.apiResponseTimes).toFixed(0)}ms`, inline: true },
                { name: "🎯 Threshold", value: `${config.thresholds.lagAlert}ms`, inline: true }
              ],
              footer: { text: "Performance Monitoring" },
              timestamp: nowISO()
            });
          }

          // Update performance metrics
          analytics.performance.uptime = Date.now() - systemMetrics.startTime;
          analytics.performance.errorRate = systemMetrics.totalChecks > 0 ? 
            ((systemMetrics.totalChecks - systemMetrics.successfulChecks) / systemMetrics.totalChecks) * 100 : 0;
        }

        systemMetrics.successfulChecks++;
        systemMetrics.consecutiveErrors = 0;

      } catch (err) {
        systemMetrics.consecutiveErrors++;
        console.error(`⚠️ Error [${systemMetrics.consecutiveErrors}/${systemMetrics.maxConsecutiveErrors}]:`, err.message);

        // Add to error log
        analytics.performance.lastErrors.push({
          message: err.message,
          timestamp: nowISO(),
          consecutiveCount: systemMetrics.consecutiveErrors
        });

        // Keep only last 10 errors
        if (analytics.performance.lastErrors.length > 10) {
          analytics.performance.lastErrors.shift();
        }

        if (systemMetrics.consecutiveErrors >= systemMetrics.maxConsecutiveErrors) {
          await postToDiscord({
            title: "🚨 Critical Error Alert",
            description: "Tracker is experiencing repeated failures and will pause temporarily.",
            color: 0xe74c3c,
            fields: [
              { name: "🔢 Error Count", value: `${systemMetrics.consecutiveErrors}`, inline: true },
              { name: "🕐 Uptime", value: formatDuration(Date.now() - systemMetrics.startTime), inline: true },
              { name: "📊 Success Rate", value: `${((systemMetrics.successfulChecks / systemMetrics.totalChecks) * 100).toFixed(1)}%`, inline: true },
              { name: "❌ Last Error", value: err.message.substring(0, 100), inline: false },
              { name: "⏸️ Action", value: "Pausing for 5 minutes then resuming", inline: false }
            ],
            footer: { text: "Error Management System" },
            timestamp: nowISO()
          });

          // 5 minute pause
          setTimeout(() => {
            systemMetrics.consecutiveErrors = 0;
            console.log("🔄 Resuming tracking after error pause...");
          }, 300000);
        }
      }
    }, config.checkInterval);

  } catch (err) {
    console.error("💥 Startup failed:", err.message);
    await postToDiscord({
      title: "💥 Critical Startup Failure",
      description: `Advanced tracker failed to initialize: ${err.message}`,
      color: 0xe74c3c,
      fields: [
        { name: "❌ Error", value: err.message.substring(0, 200), inline: false },
        { name: "🔄 Action", value: "Check configuration and restart", inline: false }
      ],
      footer: { text: "Startup Error" },
      timestamp: nowISO()
    });
    process.exit(1);
  }
}

// === GRACEFUL SHUTDOWN ===
process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  await saveData();
  await postToDiscord({
    title: "🛑 Tracker Shutdown",
    description: "Advanced Roblox Tracker is shutting down gracefully.",
    color: 0x95a5a6,
    fields: [
      { name: "⏱️ Total Uptime", value: formatDuration(Date.now() - systemMetrics.startTime), inline: true },
      { name: "✅ Total Checks", value: `${systemMetrics.successfulChecks}/${systemMetrics.totalChecks}`, inline: true },
      { name: "📊 Success Rate", value: `${((systemMetrics.successfulChecks / systemMetrics.totalChecks) * 100).toFixed(1)}%`, inline: true }
    ],
    footer: { text: "Shutdown Complete" },
    timestamp: nowISO()
  });
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Received SIGINT, saving data and exiting...');
  await saveData();
  process.exit(0);
});

// === STARTUP ===
console.log(`
╔══════════════════════════════════════╗
║     🎮 ADVANCED ROBLOX TRACKER       ║
║              Version 2.0             ║
╠══════════════════════════════════════╣
║  Features: ${Object.values(config.features).filter(Boolean).length} enabled                    ║
║  Interval: ${config.checkInterval/1000}s checks                 ║
║  Dashboard: ${config.features.enableWebDashboard ? 'Enabled' : 'Disabled'}                   ║
║  Data Persistence: ${config.features.enableDataPersistence ? 'Enabled' : 'Disabled'}         ║
╚══════════════════════════════════════╝
`);

main().catch(console.error);
