const http = require("http");
const axios = require("axios");

const port = process.env.PORT || 3000;

// === CONFIGURATION ===
const placeId = "4924922222 "; // Your Roblox Place ID
const discordWebhook = "https://discord.com/api/webhooks/1382462195937447947/7NNEJ8ES24KjbFKv8n2BrohDB7-tf-hKrupgqqHCY2eYMm2-1pmQGmcwgA9X4aZJ3jch";
const checkInterval = 15000; // Every 15 seconds
const sendHourlyUpdates = true;
const sendDailySummary = true;
const minPlayersForNotification = 1;
const enableLeaveNotifications = true;
const enablePlayerMilestones = true; // New feature
const enableVisitMilestones = true; // New feature
const enableStreakTracking = true; // New feature
// ======================

let lastCount = 0;
let gameData = {};
let lastJoinTime = null;
let lastLeaveTime = null;
let hourlyCheck = 0;
let consecutiveErrors = 0;
const maxConsecutiveErrors = 5;

// Enhanced tracking data
let dailyStats = {
  peakPlayers: 0,
  totalJoins: 0,
  totalLeaves: 0,
  startTime: new Date(),
  visitCount: 0
};

let streakData = {
  emptyStreak: 0,
  activeStreak: 0,
  longestEmptyStreak: 0,
  longestActiveStreak: 0
};

let lastVisitCount = 0;
let playerMilestones = [10, 25, 50, 100, 200, 500, 1000];
let visitMilestones = [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];

// Minimal HTTP server for UptimeRobot
const server = http.createServer((req, res) => {
  if (req.url === "/ping") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  } else if (req.url === "/stats") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      currentPlayers: lastCount,
      gameName: gameData.name || "Unknown",
      dailyStats: dailyStats,
      streakData: streakData,
      lastUpdate: new Date().toISOString()
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`🌐 Server listening on port ${port}`);
});

// === CORE TRACKING FUNCTIONS ===
async function getUniverseId() {
  const url = `https://apis.roproxy.com/universes/v1/places/${placeId}/universe`;
  const res = await axios.get(url);
  return res.data.universeId;
}

async function getGameData(universeId) {
  const url = `https://games.roproxy.com/v1/games?universeIds=${universeId}`;
  const res = await axios.get(url);
  const game = res.data.data[0];
  return {
    name: game.name,
    playing: game.playing,
    visits: game.visits,
    maxPlayers: game.maxPlayers,
    created: game.created,
    updated: game.updated,
    rating: game.rating || 0,
    genre: game.genre || "Unknown"
  };
}

function nowISO() {
  return new Date().toISOString();
}

function nowLocale() {
  return new Date().toLocaleString();
}

async function postToDiscord(embed) {
  try {
    await axios.post(discordWebhook, {
      username: "Roblox Player Tracker",
      embeds: [embed]
    });
  } catch (error) {
    console.error("❌ Discord webhook failed:", error.message);
  }
}

function updateStreaks(currentPlayers) {
  if (!enableStreakTracking) return;

  if (currentPlayers === 0) {
    streakData.emptyStreak++;
    streakData.activeStreak = 0;
    if (streakData.emptyStreak > streakData.longestEmptyStreak) {
      streakData.longestEmptyStreak = streakData.emptyStreak;
    }
  } else {
    streakData.activeStreak++;
    streakData.emptyStreak = 0;
    if (streakData.activeStreak > streakData.longestActiveStreak) {
      streakData.longestActiveStreak = streakData.activeStreak;
    }
  }
}

async function checkPlayerMilestone(currentPlayers) {
  if (!enablePlayerMilestones) return;

  for (let milestone of playerMilestones) {
    if (currentPlayers >= milestone && lastCount < milestone) {
      await postToDiscord({
        title: "🎉 Player Milestone Reached!",
        description: `**${gameData.name}** has reached **${milestone}** players!`,
        color: 0xffd700,
        fields: [
          { name: "🎯 Milestone", value: `${milestone} players`, inline: true },
          { name: "👥 Current", value: `${currentPlayers}`, inline: true },
          { name: "🕓 Time", value: nowLocale(), inline: true }
        ],
        footer: { text: "Player Milestone Alert" },
        timestamp: nowISO()
      });
      break;
    }
  }
}

async function checkVisitMilestone(currentVisits) {
  if (!enableVisitMilestones) return;

  for (let milestone of visitMilestones) {
    if (currentVisits >= milestone && lastVisitCount < milestone) {
      await postToDiscord({
        title: "🏆 Visit Milestone Reached!",
        description: `**${gameData.name}** has reached **${milestone.toLocaleString()}** visits!`,
        color: 0x9b59b6,
        fields: [
          { name: "🎯 Milestone", value: `${milestone.toLocaleString()} visits`, inline: true },
          { name: "👀 Current Visits", value: currentVisits.toLocaleString(), inline: true },
          { name: "📈 Growth", value: `+${(currentVisits - lastVisitCount).toLocaleString()}`, inline: true }
        ],
        footer: { text: "Visit Milestone Alert" },
        timestamp: nowISO()
      });
      break;
    }
  }
}

async function sendJoinEmbed(data) {
  lastJoinTime = nowLocale();
  dailyStats.totalJoins++;

  const embed = {
    title: "🎮 Player Joined!",
    description: `**${data.name}** now has **${data.playing}** players.`,
    color: 0x00ff00,
    fields: [
      { name: "👥 Online", value: `${data.playing}`, inline: true },
      { name: "👀 Visits", value: data.visits.toLocaleString(), inline: true },
      { name: "🕓 Time", value: nowLocale(), inline: true }
    ],
    footer: { text: "Roblox Join Alert" },
    timestamp: nowISO()
  };

  // Add streak info if enabled
  if (enableStreakTracking && streakData.activeStreak > 0) {
    embed.fields.push({ 
      name: "🔥 Active Streak", 
      value: `${Math.floor(streakData.activeStreak * checkInterval / 1000)}s`, 
      inline: true 
    });
  }

  await postToDiscord(embed);
}

async function sendLeaveEmbed(data) {
  if (!enableLeaveNotifications) return;
  lastLeaveTime = nowLocale();
  dailyStats.totalLeaves++;

  const embed = {
    title: "👋 Player Left",
    description: `**${data.name}** now has **${data.playing}** players.`,
    color: 0xff0000,
    fields: [
      { name: "👥 Online", value: `${data.playing}`, inline: true },
      { name: "🕓 Time", value: nowLocale(), inline: true }
    ],
    footer: { text: "Roblox Leave Alert" },
    timestamp: nowISO()
  };

  // Add empty streak warning if game is empty for too long
  if (data.playing === 0 && streakData.emptyStreak > 240) { // 1 hour empty
    embed.fields.push({ 
      name: "⚠️ Empty Streak", 
      value: `${Math.floor(streakData.emptyStreak * checkInterval / 1000 / 60)}min`, 
      inline: true 
    });
  }

  await postToDiscord(embed);
}

async function sendHourlyUpdate(data) {
  if (!sendHourlyUpdates) return;

  const embed = {
    title: "📊 Hourly Status Update",
    description: `**${data.name}** - Current Stats`,
    color: 0x3498db,
    fields: [
      { name: "👥 Players", value: `${data.playing}`, inline: true },
      { name: "👀 Visits", value: data.visits.toLocaleString(), inline: true },
      { name: "🕒 Time", value: nowLocale(), inline: true },
      { name: "🏆 Peak Today", value: `${dailyStats.peakPlayers}`, inline: true },
      { name: "📈 Joins/Leaves", value: `${dailyStats.totalJoins}/${dailyStats.totalLeaves}`, inline: true }
    ],
    footer: { text: "Hourly Update" },
    timestamp: nowISO()
  };

  // Add rating if available
  if (data.rating && data.rating > 0) {
    embed.fields.push({ name: "⭐ Rating", value: `${Math.round(data.rating)}%`, inline: true });
  }

  await postToDiscord(embed);
}

async function sendDailySummaryEmbed(data) {
  if (!sendDailySummary) return;

  const uptime = new Date() - dailyStats.startTime;
  const uptimeHours = Math.floor(uptime / (1000 * 60 * 60));

  await postToDiscord({
    title: "📆 Daily Summary",
    description: `Daily summary for **${data.name}**`,
    color: 0xf1c40f,
    fields: [
      { name: "👥 Final Count", value: `${data.playing}`, inline: true },
      { name: "🏆 Peak Players", value: `${dailyStats.peakPlayers}`, inline: true },
      { name: "📊 Total Activity", value: `${dailyStats.totalJoins} joins, ${dailyStats.totalLeaves} leaves`, inline: false },
      { name: "⏰ Last Join", value: lastJoinTime || "N/A", inline: true },
      { name: "⏳ Last Leave", value: lastLeaveTime || "N/A", inline: true },
      { name: "🕐 Tracking Time", value: `${uptimeHours}h`, inline: true },
      { name: "🔥 Longest Streaks", value: `Active: ${Math.floor(streakData.longestActiveStreak * checkInterval / 1000 / 60)}m\nEmpty: ${Math.floor(streakData.longestEmptyStreak * checkInterval / 1000 / 60)}m`, inline: false }
    ],
    footer: { text: "Roblox Tracker" },
    timestamp: nowISO()
  });

  // Reset daily stats
  dailyStats = {
    peakPlayers: data.playing,
    totalJoins: 0,
    totalLeaves: 0,
    startTime: new Date(),
    visitCount: data.visits
  };
}

// === MAIN TRACKING LOOP ===
async function main() {
  try {
    const universeId = await getUniverseId();
    gameData = await getGameData(universeId);
    lastCount = gameData.playing;
    lastVisitCount = gameData.visits;
    dailyStats.peakPlayers = gameData.playing;
    dailyStats.visitCount = gameData.visits;

    console.log(`🎮 Now tracking "${gameData.name}"`);
    console.log(`📊 Current players: ${gameData.playing}/${gameData.maxPlayers}`);
    console.log(`👀 Total visits: ${gameData.visits.toLocaleString()}`);

    // Send startup notification
    await postToDiscord({
      title: "🚀 Tracker Started",
      description: `Now tracking **${gameData.name}**`,
      color: 0x2ecc71,
      fields: [
        { name: "👥 Current Players", value: `${gameData.playing}`, inline: true },
        { name: "👀 Total Visits", value: gameData.visits.toLocaleString(), inline: true },
        { name: "🔄 Check Interval", value: `${checkInterval/1000}s`, inline: true }
      ],
      footer: { text: "Roblox Tracker" },
      timestamp: nowISO()
    });

    // Hourly updater
    setInterval(async () => {
      try {
        const current = await getGameData(universeId);
        await sendHourlyUpdate(current);

        // At midnight, send daily summary
        const now = new Date();
        if (sendDailySummary && now.getHours() === 0 && now.getMinutes() < 10) {
          await sendDailySummaryEmbed(current);
        }
      } catch (err) {
        console.error("❌ Hourly update failed:", err.message);
      }
    }, 60 * 60 * 1000); // every hour

    // Main player tracker - runs every 15 seconds
    setInterval(async () => {
      try {
        const current = await getGameData(universeId);
        const count = current.playing;

        console.log(`🔄 Check: ${count} players (was ${lastCount}) - ${nowLocale()}`);

        // Update peak players
        if (count > dailyStats.peakPlayers) {
          dailyStats.peakPlayers = count;
        }

        // Check milestones
        await checkPlayerMilestone(count);
        await checkVisitMilestone(current.visits);

        // Update streaks
        updateStreaks(count);

        // Handle player changes
        if (count > lastCount && count >= minPlayersForNotification) {
          await sendJoinEmbed(current);
        } else if (count < lastCount) {
          await sendLeaveEmbed(current);
        }

        lastCount = count;
        lastVisitCount = current.visits;
        gameData = current;
        consecutiveErrors = 0;

      } catch (err) {
        consecutiveErrors++;
        console.error(`⚠️ Error [${consecutiveErrors}/${maxConsecutiveErrors}]:`, err.message);

        if (consecutiveErrors >= maxConsecutiveErrors) {
          await postToDiscord({
            title: "❗ Too Many Errors",
            description: "Tracker is pausing due to repeated failures.",
            color: 0xe74c3c,
            fields: [
              { name: "Error Count", value: `${consecutiveErrors}`, inline: true },
              { name: "Last Error", value: err.message.substring(0, 100), inline: false }
            ],
            timestamp: nowISO()
          });

          setTimeout(() => {
            consecutiveErrors = 0;
            console.log("🔄 Resuming tracking...");
          }, 300000); // 5 minute pause
        }
      }
    }, checkInterval);

  } catch (err) {
    console.error("💥 Startup failed:", err.message);
    await postToDiscord({
      title: "💥 Startup Failed",
      description: `Failed to initialize tracker: ${err.message}`,
      color: 0xe74c3c,
      timestamp: nowISO()
    });
    process.exit(1);
  }
}

main();
