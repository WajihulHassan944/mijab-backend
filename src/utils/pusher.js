const Pusher = require("pusher");

let client = null;

function getClient() {
  if (client) return client;
  const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = process.env;
  if (!PUSHER_APP_ID || !PUSHER_KEY || !PUSHER_SECRET || !PUSHER_CLUSTER) return null;
  client = new Pusher({
    appId: PUSHER_APP_ID,
    key: PUSHER_KEY,
    secret: PUSHER_SECRET,
    cluster: PUSHER_CLUSTER,
    useTLS: true,
  });
  return client;
}

// Channel naming:
//  - "mijab-admin"        — admin dashboard: new orders, new contact messages
//  - "mijab-order-<id>"   — a single order's tracking page: status changes
//
// Realtime is a nice-to-have, never a requirement: every call is fire-and-forget
// and swallows its own errors so a Pusher outage can never break an API request.
async function publish(channel, event, data) {
  const pusher = getClient();
  if (!pusher) return; // not configured — silently no-op (e.g. local dev without keys)
  try {
    await pusher.trigger(channel, event, data);
  } catch (err) {
    console.error(`[pusher] failed to publish ${event} on ${channel}:`, err.message);
  }
}

module.exports = {
  notifyNewOrder: (order) => publish("mijab-admin", "order:new", order),
  notifyNewMessage: (message) => publish("mijab-admin", "message:new", message),
  notifyOrderUpdate: (order) => publish(`mijab-order-${order.id}`, "order:update", order),
};
