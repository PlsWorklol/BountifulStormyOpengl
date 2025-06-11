const axios = require("axios");

// === CONFIGURATION ===
const placeId = "10627207685"; // Your Roblox Place ID
const discordWebhook = "https://discord.com/api/webhooks/1382462195937447947/7NNEJ8ES24KjbFKv8n2BrohDB7-tf-hKrupgqqHCY2eYMm2-1pmQGmcwgA9X4aZJ3jch"; 
// ======================

let lastCount = 0;

async function getUniverseId() {
  const url = `https://apis.roblox.com/universes/v1/places/${placeId}/universe`;
  const res = await axios.get(url);
  return res.data.universeId;
}

async function getPlayerCount(universeId) {
  const url = `https://games.roblox.com/v1/games?universeIds=${universeId}`;
  const res = await axios.get(url);
  return res.data.data[0].playing;
}

async function sendToDiscord(count) {
  await axios.post(discordWebhook, {
    username: "Roblox Player Tracker",
    embeds: [{
      title: "🎮 Player Joined!",
      description: `Your game now has **${count}** players online.`,
      color: 0x00ff00,
      timestamp: new Date().toISOString()
    }]
  });
}

async function main() {
  const universeId = await getUniverseId();

  console.log("Tracking player joins for universe:", universeId);

  setInterval(async () => {
    try {
      const currentCount = await getPlayerCount(universeId);
      if (currentCount > lastCount) {
        await sendToDiscord(currentCount);
        console.log(`Join detected! Count is now ${currentCount}`);
      }
      lastCount = currentCount;
    } catch (err) {
      console.error("Error:", err.message);
    }
  }, 15000); // every 15 seconds
}

main();
