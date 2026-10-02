// Safepay "Express Checkout" integration — the hosted-checkout flow where
// Safepay shows the actual payment page and this server never sees a card
// number. Endpoints/shapes below are taken directly from Safepay's official
// Node SDK source (github.com/getsafepay/node-core), not guessed:
//   - src/resources/Payments/Session.ts  -> POST {host}/order/payments/v3/
//   - src/resources/Client/Passport.ts   -> POST {host}/client/passport/v1/token
//   - src/Checkout.ts                    -> embedded checkout URL + hosts
//   - RequestSender._makeAuthHeader       -> "x-sfpy-merchant-secret" header
const crypto = require("crypto");

const API_HOSTS = {
  sandbox: "https://sandbox.api.getsafepay.com",
  production: "https://api.getsafepay.com",
};

const CHECKOUT_HOSTS = {
  sandbox: "https://sandbox.api.getsafepay.com/embedded/",
  production: "https://getsafepay.com/embedded/",
};

function env() {
  return process.env.SAFEPAY_ENV === "production" ? "production" : "sandbox";
}

function isConfigured() {
  return Boolean(process.env.SAFEPAY_PUBLIC_KEY && process.env.SAFEPAY_SECRET_KEY);
}

async function request(path, body) {
  const host = API_HOSTS[env()];
  const res = await fetch(`${host}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-sfpy-merchant-secret": process.env.SAFEPAY_SECRET_KEY,
    },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.status?.message || json?.message || `Safepay request failed (${res.status})`;
    throw new Error(message);
  }
  return json;
}

/** Starts a payment session ("tracker") for the given order. Amount is in
 * whole rupees; Safepay wants the smallest subunit (paisa), so it's *100. */
async function createSession({ amount, orderId }) {
  const json = await request("/order/payments/v3/", {
    merchant_api_key: process.env.SAFEPAY_PUBLIC_KEY,
    intent: "CYBERSOURCE",
    mode: "payment",
    entry_mode: "raw",
    currency: "PKR",
    amount: Math.round(amount * 100),
    metadata: { order_id: orderId },
    include_fees: false,
  });
  const tracker = json?.data?.tracker?.token;
  if (!tracker) throw new Error("Safepay did not return a tracker token");
  return tracker;
}

/** Short-lived (1hr) client auth token required to open the hosted checkout. */
async function createClientToken() {
  const json = await request("/client/passport/v1/token", {});
  const token = json?.data;
  if (!token) throw new Error("Safepay did not return a client token");
  return token;
}

/** Builds the URL to redirect the customer to Safepay's hosted payment page. */
function buildCheckoutUrl({ tracker, tbt, orderId, redirectUrl, cancelUrl }) {
  const base = CHECKOUT_HOSTS[env()];
  const params = new URLSearchParams({
    environment: env(),
    tracker,
    tbt,
    source: "hosted",
    order_id: orderId,
    redirect_url: redirectUrl,
    cancel_url: cancelUrl,
  });
  return `${base}?${params.toString()}`;
}

/** Starts a session + client token in one call and returns the checkout URL. */
async function createCheckout({ amount, orderId, redirectUrl, cancelUrl }) {
  const [tracker, tbt] = await Promise.all([createSession({ amount, orderId }), createClientToken()]);
  return { tracker, checkoutUrl: buildCheckoutUrl({ tracker, tbt, orderId, redirectUrl, cancelUrl }) };
}

/** Verifies the X-SFPY-SIGNATURE header: HMAC-SHA512 of the parsed webhook
 * body (re-serialized), keyed with the webhook secret from the dashboard —
 * this is a different secret than the API secret key used above. */
function verifyWebhookSignature(payload, signature) {
  const webhookSecret = process.env.SAFEPAY_WEBHOOK_SECRET;
  if (!webhookSecret || !signature) return false;
  const expected = crypto.createHmac("sha512", webhookSecret).update(Buffer.from(JSON.stringify(payload))).digest("hex");
  // timing-safe compare, and guard against length mismatches throwing
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { isConfigured, createCheckout, verifyWebhookSignature };
