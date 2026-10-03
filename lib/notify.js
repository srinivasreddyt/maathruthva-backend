const { HttpError, escapeHtml } = require('./security');

const LOGO = 'https://www.maathruthva.com/logo-email.jpg';

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) throw new HttpError(500, 'Server misconfigured');
  let r;
  try {
    r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Maathruthva <orders@maathruthva.com>', to: [to], subject, html }),
    });
  } catch {
    throw new HttpError(502, 'Email service unreachable');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('Resend error status:', r.status);
    throw new HttpError(502, 'Email send failed');
  }
  return data.id;
}

async function sendWhatsAppImage({ to, caption }) {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!id || !token) throw new HttpError(500, 'Server misconfigured');
  let r;
  try {
    r = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'image', image: { link: LOGO, caption } }),
    });
  } catch {
    throw new HttpError(502, 'WhatsApp service unreachable');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('WhatsApp error status:', r.status);
    throw new HttpError(502, 'WhatsApp send failed');
  }
  return data.messages && data.messages[0] && data.messages[0].id;
}

function shell(bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F7F2E7;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:30px auto;background:#FDFBF6;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(47,74,28,0.08);">
    <div style="background:#4A6830;padding:28px 32px;text-align:center;">
      <img src="${LOGO}" alt="Maathruthva" width="64" height="64" style="display:block;width:64px;height:64px;border-radius:50%;background:#FBF8F0;padding:3px;margin:0 auto 10px;border:0;">
      <h1 style="color:#fff;margin:0;font-size:24px;font-family:Georgia,serif;">Maathruthva</h1>
      <p style="color:#DCE7C4;margin:6px 0 0;">Products of Mother Nature</p>
    </div>
    <div style="padding:32px;">${bodyHtml}</div>
    <div style="background:#EFE7D4;padding:16px 32px;text-align:center;">
      <p style="color:#8A7A50;font-size:12px;margin:0;">© 2026 Maathruthva. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}

function orderIdBlock(orderId) {
  return `<div style="background:#EFE7D4;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="margin:0;color:#8A7A50;font-size:13px;">Order ID</p>
        <p style="margin:4px 0 0;color:#4A6830;font-weight:bold;font-size:15px;">${escapeHtml(orderId)}</p>
      </div>`;
}

function orderConfirmationHtml({ name, orderId, items, total, address }) {
  const rows = items.map(i => `<tr>
      <td style="padding:8px;border-bottom:1px solid #f0e6d3;">${escapeHtml(i.name)}</td>
      <td style="padding:8px;border-bottom:1px solid #f0e6d3;text-align:center;">${escapeHtml(i.qty)}</td>
      <td style="padding:8px;border-bottom:1px solid #f0e6d3;text-align:right;">₹${escapeHtml((i.price * i.qty).toFixed(2))}</td>
    </tr>`).join('');
  return shell(`
      <h2 style="color:#2F4A1C;margin:0 0 8px;font-family:Georgia,serif;">Order Confirmed!</h2>
      <p style="color:#5E5238;margin:0 0 24px;">Hi ${escapeHtml(name || 'there')}, your order has been placed successfully.</p>
      ${orderIdBlock(orderId)}
      <h3 style="color:#33291A;margin:0 0 12px;font-size:15px;">Items Ordered</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <thead>
          <tr style="background:#EFE7D4;">
            <th style="padding:8px;text-align:left;color:#8A7A50;font-size:13px;">Item</th>
            <th style="padding:8px;text-align:center;color:#8A7A50;font-size:13px;">Qty</th>
            <th style="padding:8px;text-align:right;color:#8A7A50;font-size:13px;">Price</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="text-align:right;margin-bottom:24px;">
        <span style="font-size:16px;font-weight:bold;color:#B8901A;">Total: ₹${escapeHtml(total)}</span>
      </div>
      <h3 style="color:#33291A;margin:0 0 8px;font-size:15px;">Delivery Address</h3>
      <p style="color:#5E5238;margin:0 0 24px;">${escapeHtml(address || 'N/A')}</p>
      <p style="color:#8A7A50;font-size:13px;margin:0;">We will notify you once your order is shipped. Thank you for shopping with Maathruthva!</p>`);
}

function statusHtml({ emoji, heading, message, name, orderId }) {
  return shell(`
      <h2 style="color:#2F4A1C;margin:0 0 8px;font-family:Georgia,serif;">${emoji} ${escapeHtml(heading)}</h2>
      <p style="color:#5E5238;margin:0 0 24px;">Hi ${escapeHtml(name || 'there')}, ${escapeHtml(message)}</p>
      ${orderIdBlock(orderId)}
      <p style="color:#8A7A50;font-size:13px;margin:0;">Thank you for shopping with Maathruthva!</p>`);
}

module.exports = { sendEmail, sendWhatsAppImage, orderConfirmationHtml, statusHtml };
