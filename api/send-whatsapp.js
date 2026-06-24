const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone, paymentId } = req.body;

  if (!phone || !paymentId) {
    return res.status(400).json({ error: 'Missing phone or paymentId' });
  }

  // Normalize phone: remove spaces, dashes; add country code if missing
  let to = phone.replace(/[\s\-\(\)]/g, '');
  if (to.startsWith('0')) to = '91' + to.slice(1);
  if (!to.startsWith('+')) to = (to.startsWith('91') ? '' : '91') + to;
  to = to.replace(/^\+/, '');

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  console.log('Phone Number ID:', phoneNumberId);
  console.log('Token first 20 chars:', accessToken ? accessToken.substring(0, 20) : 'MISSING');
  console.log('Sending to:', to);

  const body = JSON.stringify({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: {
      body: `Hello! Your order has been placed successfully with Maathruthva.\n\nTracking ID: ${paymentId}\n\nThank you for shopping with us! We will deliver your order soon.`
    }
  });

  const options = {
    hostname: 'graph.facebook.com',
    path: `/v20.0/${phoneNumberId}/messages`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
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
  if (data.status !== 200) {
    console.error('WhatsApp API error:', parsed);
    return res.status(data.status).json({ error: parsed.error?.message || 'WhatsApp API error' });
  }

  res.status(200).json({ success: true, messageId: parsed.messages?.[0]?.id });
};
