const https = require('https');

const STATUS_CONTENT = {
  dispatched: {
    subject: prefix => `Your Order Has Been Dispatched - ${prefix}`,
    heading: 'Order Dispatched!',
    message: 'Great news — your order is on its way to you.',
    emoji: '🚚',
  },
  delivered: {
    subject: prefix => `Your Order Has Been Delivered - ${prefix}`,
    heading: 'Order Delivered!',
    message: 'Your order has been delivered. We hope you and your little one love it!',
    emoji: '📦',
  },
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name, orderId, status } = req.body;

  if (!email || !orderId || !status) {
    return res.status(400).json({ error: 'Missing email, orderId or status' });
  }

  const content = STATUS_CONTENT[status];
  if (!content) {
    return res.status(400).json({ error: 'Unsupported status: ' + status });
  }

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#fff8f0;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:30px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:#b5451b;padding:28px 32px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:24px;">Maathruthva</h1>
      <p style="color:#ffdacc;margin:6px 0 0;">Pure. Natural. Nourishing.</p>
    </div>
    <div style="padding:32px;">
      <h2 style="color:#b5451b;margin:0 0 8px;">${content.emoji} ${content.heading}</h2>
      <p style="color:#555;margin:0 0 24px;">Hi ${name || 'there'}, ${content.message}</p>

      <div style="background:#fff8f0;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="margin:0;color:#888;font-size:13px;">Order ID</p>
        <p style="margin:4px 0 0;color:#b5451b;font-weight:bold;font-size:15px;">${orderId}</p>
      </div>

      <p style="color:#888;font-size:13px;margin:0;">Thank you for shopping with Maathruthva!</p>
    </div>
    <div style="background:#fff8f0;padding:16px 32px;text-align:center;">
      <p style="color:#aaa;font-size:12px;margin:0;">© 2025 Maathruthva. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

  const body = JSON.stringify({
    from: 'Maathruthva <onboarding@resend.dev>',
    to: [email],
    subject: content.subject(orderId),
    html: htmlBody,
  });

  const options = {
    hostname: 'api.resend.com',
    path: '/emails',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const data = await new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      let raw = '';
      response.on('data', chunk => raw += chunk);
      response.on('end', () => resolve({ status: response.statusCode, body: raw }));
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });

  const parsed = JSON.parse(data.body);
  if (data.status !== 200 && data.status !== 201) {
    console.error('Resend status email error:', parsed);
    return res.status(data.status).json({ error: parsed.message || 'Email send failed' });
  }

  res.status(200).json({ success: true, id: parsed.id });
};
