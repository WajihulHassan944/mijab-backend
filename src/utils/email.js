// Transactional email via Brevo's REST API. Deliberately uses a plain fetch
// call instead of the Brevo SDK to keep this dependency-free — Node 18+ (and
// Vercel's Node runtime) has fetch built in.
//
// Like pusher.js, every call here is fire-and-forget: email delivery must
// never block or fail an API request. Callers should not await these in a
// way that affects the response.

// Admin alerts always go to the store's configured settings.email, plus
// this fixed address for now (requested explicitly, not yet exposed in the
// admin settings UI).
const EXTRA_ADMIN_EMAIL = "wajih786hassan@gmail.com";

function uniqueEmails(...emails) {
  return [...new Set(emails.filter(Boolean).map((e) => e.toLowerCase()))];
}

async function sendEmail({ to, toName, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || "MIJAB";
  if (!apiKey || !senderEmail) return; // not configured — no-op

  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean).map((email) => ({ email, name: toName || email }));
  if (!recipients.length) return;

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
        to: recipients,
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

// ---- Brand shell -----------------------------------------------------
// Mirrors the storefront's palette (src/app/globals.css: --bg #f3ece7,
// --card #fbf7f3, --brown #2a1d18, --rose #9b6b66, --dark #141010) so every
// email reads as part of the same site, not a bare transactional notice.
// Table-based layout (not flex/divs) because Outlook and older webmail
// clients don't reliably support anything else.
const COLORS = {
  bg: "#f3ece7",
  card: "#fbf7f3",
  ink: "#17110f",
  brown: "#2a1d18",
  body: "#4a3b35",
  muted: "#8a7a72",
  rose: "#9b6b66",
  line: "#e3d3c8",
  dark: "#141010",
  cream: "#f6eae2",
};

// Bank transfer details shown to customers (keep in sync with the storefront's
// src/lib/bank.ts).
const BANK = { name: "Bank AL Habib", account: "55640081003578010", title: "MJB" };

// Escapes user-supplied text (e.g. review bodies) before it goes into HTML.
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const FRONTEND_URL = () => (process.env.FRONTEND_URL || "").replace(/\/+$/, "");

function emailButton(href, label) {
  if (!href) return "";
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px">
      <tr>
        <td style="background-color:${COLORS.brown};border-radius:2px">
          <a href="${href}" style="display:inline-block;padding:14px 30px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${COLORS.cream};text-decoration:none">${label}</a>
        </td>
      </tr>
    </table>`;
}

function emailShell({ preheader = "", eyebrow = "", bodyHtml, footerNote = "" }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
  </head>
  <body style="margin:0;padding:0;background-color:${COLORS.bg};-webkit-text-size-adjust:100%">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${COLORS.bg}">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.bg}">
      <tr>
        <td align="center" style="padding:48px 16px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:${COLORS.card};border:1px solid ${COLORS.line}">
            <tr>
              <td align="center" style="padding:40px 40px 28px;border-bottom:1px solid ${COLORS.line}">
                <div style="font-family:Georgia,'Cormorant Garamond',serif;font-size:28px;letter-spacing:6px;color:${COLORS.brown}">MIJAB</div>
                ${eyebrow ? `<div style="margin-top:10px;font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:${COLORS.rose}">${eyebrow}</div>` : ""}
              </td>
            </tr>
            <tr>
              <td style="padding:36px 40px;font-family:Helvetica,Arial,sans-serif;color:${COLORS.body}">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:28px 40px;background-color:${COLORS.dark}">
                <div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.8;color:#c9b8ae">
                  MIJAB — mjb_essence@outlook.com
                  ${footerNote ? `<br/>${footerNote}` : ""}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

const kvRow = (k, v) => `
  <tr>
    <td style="padding:5px 0;font-size:13px;color:${COLORS.muted}">${k}</td>
    <td style="padding:5px 0;font-size:13px;color:${COLORS.ink};text-align:right">${v}</td>
  </tr>`;

// Full invoice layout: header with brand + invoice meta, itemized table with
// unit price, totals, billing info, bank transfer details inline when
// relevant, and a "track order" CTA.
function sendOrderConfirmation(order) {
  const itemsHtml = order.lines
    .map(
      (l) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid ${COLORS.line};font-size:14px;color:${COLORS.ink}">${l.name}</td>
        <td style="padding:12px 0;border-bottom:1px solid ${COLORS.line};font-size:14px;text-align:center;color:${COLORS.body}">${l.qty}</td>
        <td style="padding:12px 0;border-bottom:1px solid ${COLORS.line};font-size:14px;text-align:right;color:${COLORS.body}">${money(l.price)}</td>
        <td style="padding:12px 0;border-bottom:1px solid ${COLORS.line};font-size:14px;text-align:right;color:${COLORS.ink};font-weight:bold">${money(l.price * l.qty)}</td>
      </tr>`,
    )
    .join("");

  const isBankTransfer = order.payment === "Bank transfer";
  const isPickup = order.fulfillment === "pickup";
  const trackUrl = FRONTEND_URL() ? `${FRONTEND_URL()}/track?order=${encodeURIComponent(order.id)}` : "";

  const bodyHtml = `
    <h1 style="margin:0 0 6px;font-family:Georgia,'Cormorant Garamond',serif;font-weight:normal;font-size:28px;color:${COLORS.ink}">Thank you, ${order.name.split(" ")[0]}</h1>
    <p style="margin:0 0 4px;font-size:13px;color:${COLORS.muted}">Invoice <strong style="color:${COLORS.ink}">${order.id}</strong> &middot; ${order.placedOn}</p>
    <p style="margin:16px 0 24px;font-size:14px;line-height:1.7;color:${COLORS.body}">Your order has been received and is being prepared. Here's your receipt.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr>
        <td style="padding-bottom:8px;border-bottom:1px solid ${COLORS.brown};font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.muted}">Item</td>
        <td style="padding-bottom:8px;border-bottom:1px solid ${COLORS.brown};font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.muted};text-align:center">Qty</td>
        <td style="padding-bottom:8px;border-bottom:1px solid ${COLORS.brown};font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.muted};text-align:right">Price</td>
        <td style="padding-bottom:8px;border-bottom:1px solid ${COLORS.brown};font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.muted};text-align:right">Total</td>
      </tr>
      ${itemsHtml}
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px">
      ${kvRow("Subtotal", money(order.subtotal))}
      ${order.discount ? kvRow(`Discount${order.promoCode ? ` (${order.promoCode})` : ""}`, `−${money(order.discount)}`) : ""}
      ${kvRow(isPickup ? "Store pickup" : "Delivery", order.delivery ? money(order.delivery) : "Free")}
      <tr>
        <td style="padding-top:12px;border-top:1px solid ${COLORS.brown};font-size:16px;font-weight:bold;color:${COLORS.ink}">Total due</td>
        <td style="padding-top:12px;border-top:1px solid ${COLORS.brown};font-size:16px;font-weight:bold;color:${COLORS.ink};text-align:right">${money(order.total)}</td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px">
      <tr>
        <td style="vertical-align:top;width:50%;padding-right:12px">
          <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.rose};margin-bottom:6px">${isPickup ? "Store pickup" : "Billed &amp; shipped to"}</div>
          <div style="font-size:13px;line-height:1.7;color:${COLORS.body}">${order.name}<br/>${isPickup ? `${esc(order.address)}<br/>We'll let you know when it's ready to collect.` : `${order.address}<br/>${order.city}`}</div>
        </td>
        <td style="vertical-align:top;width:50%">
          <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.rose};margin-bottom:6px">Payment method</div>
          <div style="font-size:13px;line-height:1.7;color:${COLORS.body}">${order.payment}</div>
        </td>
      </tr>
    </table>

    ${
      isBankTransfer
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;background-color:${COLORS.bg};border:1px solid ${COLORS.line}">
            <tr><td style="padding:18px 20px">
              <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.rose};margin-bottom:8px">Pay via bank transfer</div>
              <div style="font-size:14px;color:${COLORS.ink};line-height:1.8">Bank: <strong>${BANK.name}</strong><br/>Account number: <strong>${BANK.account}</strong><br/>Account title: <strong>${BANK.title}</strong></div>
              <div style="font-size:12px;color:${COLORS.muted};margin-top:10px;line-height:1.6">Please send ${money(order.total)} and upload your payment screenshot so we can confirm your order.</div>
            </td></tr>
          </table>`
        : ""
    }

    ${emailButton(trackUrl, "Track your order")}

    <p style="margin:20px 0 0;font-size:12px;color:${COLORS.muted};padding-top:16px;border-top:1px solid ${COLORS.line}">
      Track this order anytime with order ID <strong style="color:${COLORS.ink}">${order.id}</strong> and your phone number.
    </p>`;

  const html = emailShell({
    preheader: `Your MIJAB order ${order.id} is confirmed — ${money(order.total)}`,
    eyebrow: "Order Confirmed",
    bodyHtml,
  });

  return sendEmail({ to: order.email, toName: order.name, subject: `Invoice ${order.id} — MIJAB`, html });
}

const STATUS_COPY = {
  placed: { subject: "Order received", eyebrow: "Order Update", headline: "Your order has been received", body: "We're getting it ready." },
  packed: { subject: "Your order is packed", eyebrow: "Order Update", headline: "Your order has been packed", body: "It'll be handed over for delivery shortly." },
  out: { subject: "Your order is out for delivery", eyebrow: "Order Update", headline: "Your order is on its way", body: "It should arrive soon." },
  delivered: { subject: "Your order has been delivered", eyebrow: "Order Delivered", headline: "Your order has been delivered", body: "We hope you love it. Thank you for shopping with MIJAB." },
  cancelled: { subject: "Your order has been cancelled", eyebrow: "Order Cancelled", headline: "Your order has been cancelled", body: "If this wasn't expected, please get in touch and we'll sort it out." },
};

// Pickup orders reuse the same statuses; only the wording differs.
const PICKUP_COPY = {
  packed: { subject: "Your order is packed", eyebrow: "Order Update", headline: "Your order has been packed", body: "We'll let you know as soon as it's ready to collect." },
  out: { subject: "Your order is ready for pickup", eyebrow: "Ready for Pickup", headline: "Your order is ready to collect", body: "Please bring your order ID when you come to collect it." },
  delivered: { subject: "Your order has been collected", eyebrow: "Order Collected", headline: "Thank you for collecting your order", body: "We hope you love it. Thank you for shopping with MIJAB." },
};

function sendOrderStatusUpdate(order, status) {
  const isPickup = order.fulfillment === "pickup";
  const copy = (isPickup && PICKUP_COPY[status]) || STATUS_COPY[status];
  if (!copy) return;

  const trackUrl = FRONTEND_URL() ? `${FRONTEND_URL()}/track?order=${encodeURIComponent(order.id)}` : "";
  const reviewUrl = FRONTEND_URL() ? `${FRONTEND_URL()}/review?order=${encodeURIComponent(order.id)}` : "";
  const isDelivered = status === "delivered";

  const bodyHtml = `
    <h1 style="margin:0 0 6px;font-family:Georgia,'Cormorant Garamond',serif;font-weight:normal;font-size:26px;color:${COLORS.ink}">${copy.headline}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:${COLORS.body}">Order <strong style="color:${COLORS.ink}">${order.id}</strong> &middot; ${copy.body}</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.bg};border:1px solid ${COLORS.line}">
      <tr><td style="padding:16px 20px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${isPickup ? kvRow("Pickup from", esc(order.address)) : kvRow("Delivering to", `${order.address}, ${order.city}`)}
          ${kvRow("Total", money(order.total))}
        </table>
      </td></tr>
    </table>

    ${
      isDelivered
        ? `<p style="margin:24px 0 0;font-size:14px;line-height:1.7;color:${COLORS.body}">Loved your MIJAB? We'd be grateful if you shared a few words about it.</p>
           ${emailButton(reviewUrl, "Leave a review")}`
        : emailButton(trackUrl, "Track your order")
    }

    <p style="margin:20px 0 0;font-size:12px;color:${COLORS.muted};padding-top:16px;border-top:1px solid ${COLORS.line}">
      Track this order anytime with order ID <strong style="color:${COLORS.ink}">${order.id}</strong> and your phone number.
    </p>`;

  const html = emailShell({ preheader: `${copy.headline} — ${order.id}`, eyebrow: copy.eyebrow, bodyHtml });
  return sendEmail({ to: order.email, toName: order.name, subject: `${copy.subject} — ${order.id}`, html });
}

function sendMessageReply(message) {
  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-family:Georgia,'Cormorant Garamond',serif;font-weight:normal;font-size:24px;color:${COLORS.ink}">Re: ${message.subject}</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.75;color:${COLORS.body};white-space:pre-wrap">${message.reply}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.bg};border:1px solid ${COLORS.line}">
      <tr><td style="padding:16px 20px">
        <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.rose};margin-bottom:6px">Your message</div>
        <div style="font-size:13px;line-height:1.7;color:${COLORS.muted};white-space:pre-wrap">${message.body}</div>
      </td></tr>
    </table>`;

  const html = emailShell({ preheader: `Re: ${message.subject}`, eyebrow: "A reply from MIJAB", bodyHtml });
  return sendEmail({ to: message.email, toName: message.name, subject: `Re: ${message.subject} — MIJAB`, html });
}

function sendAdminNewOrderAlert(order, adminEmail) {
  const itemsHtml = order.lines
    .map(
      (l) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid ${COLORS.line};font-size:13px;color:${COLORS.ink}">${l.name}</td>
        <td style="padding:8px 0;border-bottom:1px solid ${COLORS.line};font-size:13px;text-align:center;color:${COLORS.body}">${l.qty}</td>
        <td style="padding:8px 0;border-bottom:1px solid ${COLORS.line};font-size:13px;text-align:right;color:${COLORS.body}">${money(l.price)}</td>
        <td style="padding:8px 0;border-bottom:1px solid ${COLORS.line};font-size:13px;text-align:right;color:${COLORS.ink};font-weight:bold">${money(l.price * l.qty)}</td>
      </tr>`,
    )
    .join("");

  const isBankTransfer = order.payment === "Bank transfer";
  const orderUrl = FRONTEND_URL() ? `${FRONTEND_URL()}/admin/orders/${encodeURIComponent(order.id)}` : "";

  const bodyHtml = `
    <h1 style="margin:0 0 4px;font-family:Georgia,'Cormorant Garamond',serif;font-weight:normal;font-size:26px;color:${COLORS.ink}">New order: ${order.id}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:${COLORS.body}">${order.placedOn} &middot; ${money(order.total)}</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
      <tr>
        <td style="background-color:${COLORS.brown};padding:12px 18px">
          <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.rose}">Payment method</div>
          <div style="font-size:16px;font-weight:bold;color:${COLORS.cream};margin-top:2px">${order.payment}${isBankTransfer ? " — awaiting screenshot" : ""}</div>
          ${order.fulfillment === "pickup" ? `<div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.cream};margin-top:6px">Store pickup — no delivery</div>` : ""}
        </td>
      </tr>
    </table>

    <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.rose};margin-bottom:6px">Customer</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
      ${kvRow("Name", order.name)}
      ${kvRow("Email", order.email)}
      ${kvRow("Phone", order.phone)}
      ${order.fulfillment === "pickup" ? kvRow("Fulfilment", "Store pickup") : kvRow("Delivering to", `${order.address}, ${order.city}`)}
    </table>

    <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.rose};margin-bottom:6px">Items</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:12px">
      <tr>
        <td style="padding-bottom:6px;border-bottom:1px solid ${COLORS.brown};font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.muted}">Item</td>
        <td style="padding-bottom:6px;border-bottom:1px solid ${COLORS.brown};font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.muted};text-align:center">Qty</td>
        <td style="padding-bottom:6px;border-bottom:1px solid ${COLORS.brown};font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.muted};text-align:right">Price</td>
        <td style="padding-bottom:6px;border-bottom:1px solid ${COLORS.brown};font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.muted};text-align:right">Total</td>
      </tr>
      ${itemsHtml}
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${kvRow("Subtotal", money(order.subtotal))}
      ${order.discount ? kvRow(`Discount${order.promoCode ? ` (${order.promoCode})` : ""}`, `−${money(order.discount)}`) : ""}
      ${kvRow("Delivery", order.delivery ? money(order.delivery) : "Free")}
      <tr>
        <td style="padding-top:10px;border-top:1px solid ${COLORS.brown};font-size:15px;font-weight:bold;color:${COLORS.ink}">Total</td>
        <td style="padding-top:10px;border-top:1px solid ${COLORS.brown};font-size:15px;font-weight:bold;color:${COLORS.ink};text-align:right">${money(order.total)}</td>
      </tr>
    </table>

    ${emailButton(orderUrl, "Open in admin")}`;

  const html = emailShell({ preheader: `New order ${order.id} — ${order.payment} — ${money(order.total)}`, eyebrow: "Admin Alert", bodyHtml });
  return sendEmail({ to: uniqueEmails(adminEmail, EXTRA_ADMIN_EMAIL), subject: `New order ${order.id} (${order.payment}) — ${money(order.total)}`, html });
}

function sendAdminPaymentProofAlert(order, adminEmail, proofUrl) {
  const bodyHtml = `
    <h1 style="margin:0 0 6px;font-family:Georgia,'Cormorant Garamond',serif;font-weight:normal;font-size:24px;color:${COLORS.ink}">Payment screenshot uploaded</h1>
    <p style="margin:0 0 20px;font-size:14px;color:${COLORS.body}">${order.name} (${order.phone}) uploaded proof of a ${money(order.total)} bank transfer for order <strong style="color:${COLORS.ink}">${order.id}</strong>.</p>
    ${emailButton(proofUrl, "View screenshot")}`;
  const html = emailShell({ preheader: `Payment proof: ${order.id}`, eyebrow: "Admin Alert", bodyHtml });
  return sendEmail({ to: uniqueEmails(adminEmail, EXTRA_ADMIN_EMAIL), subject: `Payment proof: ${order.id}`, html });
}

function sendAdminNewReviewAlert(review, adminEmail) {
  const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
  const adminUrl = FRONTEND_URL() ? `${FRONTEND_URL()}/admin/reviews` : "";
  const bodyHtml = `
    <h1 style="margin:0 0 6px;font-family:Georgia,'Cormorant Garamond',serif;font-weight:normal;font-size:24px;color:${COLORS.ink}">New review awaiting approval</h1>
    <p style="margin:0 0 20px;font-size:14px;color:${COLORS.body}">${esc(review.name)} &middot; order <strong style="color:${COLORS.ink}">${esc(review.orderId)}</strong></p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.bg};border:1px solid ${COLORS.line}">
      <tr><td style="padding:16px 20px">
        <div style="font-size:18px;letter-spacing:2px;color:${COLORS.rose}">${stars}</div>
        <div style="margin-top:8px;font-size:13px;line-height:1.7;color:${COLORS.body};white-space:pre-wrap">${esc(review.body)}</div>
      </td></tr>
    </table>
    <p style="margin:16px 0 0;font-size:12px;color:${COLORS.muted}">It won't appear on the site until you approve it.</p>
    ${emailButton(adminUrl, "Review in admin")}`;
  const html = emailShell({ preheader: `New ${review.rating}-star review from ${esc(review.name)}`, eyebrow: "Admin Alert", bodyHtml });
  return sendEmail({ to: uniqueEmails(adminEmail, EXTRA_ADMIN_EMAIL), subject: `New review (${review.rating}★) — ${review.orderId}`, html });
}

function sendAdminLowStockAlert(products, adminEmail) {
  const rows = products
    .map((p) => kvRow(p.name, `${p.stock} left`))
    .join("");
  const bodyHtml = `
    <h1 style="margin:0 0 20px;font-family:Georgia,'Cormorant Garamond',serif;font-weight:normal;font-size:24px;color:${COLORS.ink}">Low stock alert</h1>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.bg};border:1px solid ${COLORS.line}">
      <tr><td style="padding:16px 20px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      </td></tr>
    </table>`;
  const html = emailShell({ preheader: "Low stock alert", eyebrow: "Admin Alert", bodyHtml });
  return sendEmail({ to: uniqueEmails(adminEmail, EXTRA_ADMIN_EMAIL), subject: `Low stock: ${products.map((p) => p.name).join(", ")}`, html });
}

function sendAdminNewMessageAlert(message, adminEmail) {
  const bodyHtml = `
    <h1 style="margin:0 0 6px;font-family:Georgia,'Cormorant Garamond',serif;font-weight:normal;font-size:24px;color:${COLORS.ink}">New message: ${message.subject}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:${COLORS.body}">From ${message.name} (${message.email})</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.bg};border:1px solid ${COLORS.line}">
      <tr><td style="padding:16px 20px;font-size:13px;line-height:1.7;color:${COLORS.body};white-space:pre-wrap">${message.body}</td></tr>
    </table>`;
  const html = emailShell({ preheader: `New message: ${message.subject}`, eyebrow: "Admin Alert", bodyHtml });
  return sendEmail({ to: uniqueEmails(adminEmail, EXTRA_ADMIN_EMAIL), subject: `New message: ${message.subject}`, html });
}

module.exports = {
  sendEmail,
  sendOrderConfirmation,
  sendOrderStatusUpdate,
  sendMessageReply,
  sendAdminNewOrderAlert,
  sendAdminPaymentProofAlert,
  sendAdminNewReviewAlert,
  sendAdminLowStockAlert,
  sendAdminNewMessageAlert,
};
