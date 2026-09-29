const { TikTokLiveConnection } = require('tiktok-live-connector');
async function test() {
  const conn = new TikTokLiveConnection('windahbasudara', {});
  try {
    const state = await conn.connect();
    console.log("SUCCESS!", state.roomId);
    process.exit(0);
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  }
}
test();
