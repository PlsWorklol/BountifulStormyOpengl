const express = require("express");
const axios = require("axios");
const app = express();
const port = 3000;

// === CONFIGURATION ===
const placeId = "10627207685"; // Your Roblox Place ID
const discordWebhook = "https://discord.com/api/webhooks/1382462195937447947/7NNEJ8ES24KjbFKv8n2BrohDB7-tf-hKrupgqqHCY2eYMm2-1pmQGmcwgA9X4aZJ3jch";
const checkInterval = 15000; // Every 15 seconds
const sendHourlyUpdates = true;
const enableDailySummary = true;
const minPlayersForNotification = 1;
const enableLeaveNotifications = true;
// ======================

let lastCount = 0;
let gameData = {};
let lastJoinTime = null;
let lastLeaveTime = null;
let hourlyCheck = 0;
let consecutiveErrors = 0;
const maxConsecutiveErrors = 5;

// === EXPRESS SERVER ===
app.get("/", (req, res) => {
  res.send(`<h2>🟢 Roblox Tracker Running</h2><p>Players Online: ${gameData.playing || 0}</p>`);
});

app.get("/ping", (req, res) => {
  res.send("✅ Ping OK");
});

app.listen(port, '0.0.0.0', () => {
  console.log(`🌍 Public URL: Visit this app at https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`);
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
    updated: game.updated
  };
}

function nowISO() {
  return new Date().toISOString();
}

function nowLocale() {
  return new Date().toLocaleString();
}

async function postToDiscord(embed) {
  await axios.post(discordWebhook, {
    username: "Roblox Player Tracker",
    embeds: [embed]
  });
}

async function sendJoinEmbed(data) {
  lastJoinTime = nowLocale();
  await postToDiscord({
    title: "🎮 Player Joined!",
    description: `**${data.name}** now has **${data.playing}** players.`,
    color: 0x00ff00,
    fields: [
      { name: "👥 Online", value: `${data.playing}/${data.maxPlayers}`, inline: true },
      { name: "👀 Visits", value: data.visits.toLocaleString(), inline: true },
      { name: "🕓 Time", value: nowLocale(), inline: true }
    ],
    footer: { text: "Roblox Join Alert" },
    timestamp: nowISO()
  });
}

async function sendLeaveEmbed(data) {
  if (!enableLeaveNotifications) return;
  lastLeaveTime = nowLocale();
  await postToDiscord({
    title: "👋 Player Left",
    description: `**${data.name}** now has **${data.playing}** players.`,
    color: 0xff0000,
    fields: [
      { name: "👥 Online", value: `${data.playing}/${data.maxPlayers}`, inline: true },
      { name: "🕓 Time", value: nowLocale(), inline: true }
    ],
    footer: { text: "Roblox Leave Alert" },
    timestamp: nowISO()
  });
}

async function sendHourlyUpdate(data) {
  if (!sendHourlyUpdates) return;
  await postToDiscord({
    title: "📊 Hourly Status Update",
    description: `**${data.name}** - Current Stats`,
    color: 0x3498db,
    fields: [
      { name: "👥 Players", value: `${data.playing}/${data.maxPlayers}`, inline: true },
      { name: "👀 Visits", value: data.visits.toLocaleString(), inline: true },
      { name: "🕒 Time", value: nowLocale(), inline: true }
    ],
    footer: { text: "Hourly Update" },
    timestamp: nowISO()
  });
}

async function sendDailySummary(data) {
  if (!enableDailySummary) return;
  await postToDiscord({
    title: "📆 Daily Summary",
    description: `Daily summary for **${data.name}**`,
    color: 0xf1c40f,
    fields: [
      { name: "👥 Final Count", value: `${data.playing}`, inline: true },
      { name: "⏰ Last Join", value: lastJoinTime || "N/A", inline: true },
      { name: "⏳ Last Leave", value: lastLeaveTime || "N/A", inline: true }
    ],
    footer: { text: "Roblox Tracker" },
    timestamp: nowISO()
  });
}

// === MAIN TRACKING LOOP ===
async function main() {
  try {
    const universeId = await getUniverseId();
    gameData = await getGameData(universeId);
    lastCount = gameData.playing;
    console.log(`🎮 Now tracking "${gameData.name}"`);

    // Hourly updater
    setInterval(async () => {
      hourlyCheck++;
      try {
        const current = await getGameData(universeId);
        await sendHourlyUpdate(current);

        const hour = new Date().getHours();
        const minute = new Date().getMinutes();
        if (enableDailySummary && hour === 0 && minute < 10) {
          await sendDailySummary(current);
        }
      } catch (err) {
        console.error("❌ Hourly update failed:", err.message);
      }
    }, 60 * 60 * 1000); // every hour

    // Player tracker
    setInterval(async () => {
      try {
        const current = await getGameData(universeId);
        const count = current.playing;

        if (count > lastCount && count >= minPlayersForNotification) {
          await sendJoinEmbed(current);
        } else if (count < lastCount) {
          await sendLeaveEmbed(current);
        }

        lastCount = count;
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
            timestamp: nowISO()
          });

          setTimeout(() => {
            consecutiveErrors = 0;
            console.log("🔄 Resuming tracking...");
          }, 300000);
        }
      }
    }, checkInterval);

  } catch (err) {
    console.error("💥 Startup failed:", err.message);
    process.exit(1);
  }
}

main();
