const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name, paymentId, items, total, address } = req.body;

  if (!email || !paymentId) {
    return res.status(400).json({ error: 'Missing email or paymentId' });
  }

  const itemsHtml = (items || []).map(i =>
    `<tr>
      <td style="padding:8px;border-bottom:1px solid #f0e6d3;">${i.name}</td>
      <td style="padding:8px;border-bottom:1px solid #f0e6d3;text-align:center;">${i.qty}</td>
      <td style="padding:8px;border-bottom:1px solid #f0e6d3;text-align:right;">₹${(i.price * i.qty).toFixed(2)}</td>
    </tr>`
  ).join('');

  const addressHtml = address
    ? `${address.line1 || ''}, ${address.city || ''}, ${address.state || ''} - ${address.pincode || ''}`
    : 'N/A';

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
      <h2 style="color:#b5451b;margin:0 0 8px;">Order Confirmed!</h2>
      <p style="color:#555;margin:0 0 24px;">Hi ${name || 'there'}, your order has been placed successfully.</p>

      <div style="background:#fff8f0;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="margin:0;color:#888;font-size:13px;">Tracking ID</p>
        <p style="margin:4px 0 0;color:#b5451b;font-weight:bold;font-size:15px;">${paymentId}</p>
      </div>

      <h3 style="color:#333;margin:0 0 12px;font-size:15px;">Items Ordered</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <thead>
          <tr style="background:#fff8f0;">
            <th style="padding:8px;text-align:left;color:#888;font-size:13px;">Item</th>
            <th style="padding:8px;text-align:center;color:#888;font-size:13px;">Qty</th>
            <th style="padding:8px;text-align:right;color:#888;font-size:13px;">Price</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <div style="text-align:right;margin-bottom:24px;">
        <span style="font-size:16px;font-weight:bold;color:#b5451b;">Total: ₹${total}</span>
      </div>

      <h3 style="color:#333;margin:0 0 8px;font-size:15px;">Delivery Address</h3>
      <p style="color:#555;margin:0 0 24px;">${addressHtml}</p>

      <p style="color:#888;font-size:13px;margin:0;">We will notify you once your order is shipped. Thank you for shopping with Maathruthva!</p>
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
    subject: `Order Confirmed - Tracking ID: ${paymentId}`,
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
    console.error('Resend email error:', parsed);
    return res.status(data.status).json({ error: parsed.message || 'Email send failed' });
  }

  res.status(200).json({ success: true, id: parsed.id });
};
