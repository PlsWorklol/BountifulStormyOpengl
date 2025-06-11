
const axios = require("axios");

// === CONFIGURATION ===
const placeId = "10627207685"; // Your Roblox Place ID
const discordWebhook = "https://discord.com/api/webhooks/1382462195937447947/7NNEJ8ES24KjbFKv8n2BrohDB7-tf-hKrupgqqHCY2eYMm2-1pmQGmcwgA9X4aZJ3jch"; 
const checkInterval = 15000; // 15 seconds
const enableLeaveNotifications = true; // Set to false to disable leave notifications
const minPlayersForNotification = 1; // Minimum players needed to send notifications
// ======================

let lastCount = 0;
let gameData = {};
let consecutiveErrors = 0;
const maxConsecutiveErrors = 5;

async function getUniverseId() {
  const url = `https://apis.roblox.com/universes/v1/places/${placeId}/universe`;
  const res = await axios.get(url);
  return res.data.universeId;
}

async function getGameData(universeId) {
  const url = `https://games.roblox.com/v1/games?universeIds=${universeId}`;
  const res = await axios.get(url);
  const game = res.data.data[0];
  return {
    playing: game.playing,
    visits: game.visits,
    name: game.name,
    maxPlayers: game.maxPlayers,
    created: game.created,
    updated: game.updated
  };
}

async function sendJoinNotification(data) {
  await axios.post(discordWebhook, {
    username: "Roblox Player Tracker",
    embeds: [{
      title: "🎮 Player Joined!",
      description: `**${data.name}** now has **${data.playing}** players online.`,
      color: 0x00ff00,
      fields: [
        {
          name: "👥 Players",
          value: `${data.playing}/${data.maxPlayers}`,
          inline: true
        },
        {
          name: "👀 Total Visits",
          value: data.visits.toLocaleString(),
          inline: true
        },
        {
          name: "🔗 Play Now",
          value: `[Click to Play](https://www.roblox.com/games/${placeId})`,
          inline: true
        }
      ],
      thumbnail: {
        url: "https://cdn.discordapp.com/emojis/1234567890/game.png" // Generic game icon
      },
      timestamp: new Date().toISOString(),
      footer: {
        text: "Roblox Player Tracker"
      }
    }]
  });
}

async function sendLeaveNotification(data) {
  if (!enableLeaveNotifications) return;
  
  await axios.post(discordWebhook, {
    username: "Roblox Player Tracker",
    embeds: [{
      title: "👋 Player Left",
      description: `**${data.name}** now has **${data.playing}** players online.`,
      color: 0xff6b6b,
      fields: [
        {
          name: "👥 Players",
          value: `${data.playing}/${data.maxPlayers}`,
          inline: true
        },
        {
          name: "👀 Total Visits",
          value: data.visits.toLocaleString(),
          inline: true
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: "Roblox Player Tracker"
      }
    }]
  });
}

async function sendStatusUpdate(data) {
  await axios.post(discordWebhook, {
    username: "Roblox Player Tracker",
    embeds: [{
      title: "📊 Game Status Update",
      description: `Current status for **${data.name}**`,
      color: 0x5865f2,
      fields: [
        {
          name: "👥 Current Players",
          value: `${data.playing}/${data.maxPlayers}`,
          inline: true
        },
        {
          name: "👀 Total Visits",
          value: data.visits.toLocaleString(),
          inline: true
        },
        {
          name: "📅 Last Updated",
          value: new Date(data.updated).toLocaleDateString(),
          inline: true
        },
        {
          name: "🔗 Play Now",
          value: `[Click to Play](https://www.roblox.com/games/${placeId})`,
          inline: false
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: "Hourly Status Update"
      }
    }]
  });
}

async function sendErrorNotification(error) {
  await axios.post(discordWebhook, {
    username: "Roblox Player Tracker",
    embeds: [{
      title: "⚠️ Tracker Error",
      description: `The player tracker encountered an error and has been temporarily disabled.`,
      color: 0xff0000,
      fields: [
        {
          name: "Error",
          value: `\`${error.message}\``,
          inline: false
        },
        {
          name: "Consecutive Errors",
          value: consecutiveErrors.toString(),
          inline: true
        }
      ],
      timestamp: new Date().toISOString()
    }]
  });
}

async function main() {
  try {
    const universeId = await getUniverseId();
    gameData = await getGameData(universeId);
    lastCount = gameData.playing;

    console.log(`🎮 Tracking "${gameData.name}"`);
    console.log(`📊 Universe ID: ${universeId}`);
    console.log(`👥 Current Players: ${gameData.playing}/${gameData.maxPlayers}`);
    console.log(`👀 Total Visits: ${gameData.visits.toLocaleString()}`);
    console.log("✅ Bot started successfully!\n");

    // Send hourly status updates
    setInterval(async () => {
      try {
        const currentData = await getGameData(universeId);
        await sendStatusUpdate(currentData);
        console.log("📊 Sent hourly status update");
      } catch (err) {
        console.error("❌ Error sending status update:", err.message);
      }
    }, 3600000); // 1 hour

    // Main tracking loop
    setInterval(async () => {
      try {
        const currentData = await getGameData(universeId);
        const currentCount = currentData.playing;
        
        if (currentCount > lastCount && currentCount >= minPlayersForNotification) {
          await sendJoinNotification(currentData);
          console.log(`✅ Join detected! Players: ${lastCount} → ${currentCount}`);
        } else if (currentCount < lastCount && enableLeaveNotifications) {
          await sendLeaveNotification(currentData);
          console.log(`👋 Leave detected! Players: ${lastCount} → ${currentCount}`);
        }
        
        lastCount = currentCount;
        gameData = currentData;
        consecutiveErrors = 0; // Reset error counter on success
        
      } catch (err) {
        consecutiveErrors++;
        console.error(`❌ Error (${consecutiveErrors}/${maxConsecutiveErrors}):`, err.message);
        
        if (consecutiveErrors >= maxConsecutiveErrors) {
          await sendErrorNotification(err);
          console.error("🛑 Too many consecutive errors. Notifications disabled temporarily.");
          
          // Wait 5 minutes before retrying
          setTimeout(() => {
            consecutiveErrors = 0;
            console.log("🔄 Resetting error counter. Resuming normal operation.");
          }, 300000);
        }
      }
    }, checkInterval);

  } catch (err) {
    console.error("💥 Fatal error during initialization:", err.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down Roblox Player Tracker...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down Roblox Player Tracker...');
  process.exit(0);
});

main();
