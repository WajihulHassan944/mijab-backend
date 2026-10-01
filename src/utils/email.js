// Transactional email via Brevo's REST API. Deliberately uses a plain fetch
// call instead of the Brevo SDK to keep this dependency-free — Node 18+ (and
// Vercel's Node runtime) has fetch built in.
//
// Like pusher.js, every call here is fire-and-forget: email delivery must
// never block or fail an API request. Callers should not await these in a
// way that affects the response.
async function sendEmail({ to, toName, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || "MIJAB";
  if (!apiKey || !senderEmail) return; // not configured — no-op

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: to, name: toName || to }],
        subject,
        htmlContent: html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[email] Brevo send failed (${res.status}):`, body);
    }
  } catch (err) {
    console.error("[email] send failed:", err.message);
  }
}

const money = (n) => `Rs. ${Math.round(n).toLocaleString("en-US")}`;

function sendOrderConfirmation(order) {
  const itemsHtml = order.lines
    .map((l) => `<tr><td style="padding:4px 0">${l.name} × ${l.qty}</td><td style="padding:4px 0;text-align:right">${money(l.price * l.qty)}</td></tr>`)
    .join("");

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2 style="margin-bottom:0">Thanks for your order, ${order.name.split(" ")[0]}</h2>
      <p style="color:#555">Order <strong>${order.id}</strong> placed on ${order.placedOn}.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">${itemsHtml}</table>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #eee;padding-top:8px">
        <tr><td>Subtotal</td><td style="text-align:right">${money(order.subtotal)}</td></tr>
        ${order.discount ? `<tr><td>Discount</td><td style="text-align:right">-${money(order.discount)}</td></tr>` : ""}
        <tr><td>Delivery</td><td style="text-align:right">${order.delivery ? money(order.delivery) : "Free"}</td></tr>
        <tr style="font-weight:bold"><td>Total</td><td style="text-align:right">${money(order.total)}</td></tr>
      </table>
      <p style="color:#555">Delivering to: ${order.address}, ${order.city}<br/>Payment: ${order.payment}</p>
      <p style="color:#888;font-size:13px">Track this order anytime with order ID <strong>${order.id}</strong> and your phone number.</p>
    </div>`;

  return sendEmail({ to: order.email, toName: order.name, subject: `Order ${order.id} confirmed — MIJAB`, html });
}

function sendMessageReply(message) {
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2>Re: ${message.subject}</h2>
      <p style="white-space:pre-wrap">${message.reply}</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
      <p style="color:#888;font-size:13px">In reply to your message: "${message.body}"</p>
    </div>`;

  return sendEmail({ to: message.email, toName: message.name, subject: `Re: ${message.subject} — MIJAB`, html });
}

module.exports = { sendEmail, sendOrderConfirmation, sendMessageReply };
