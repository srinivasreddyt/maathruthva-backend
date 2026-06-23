const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { amount, currency = 'INR', receipt } = req.body;

  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  const auth = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
  ).toString('base64');

  const body = JSON.stringify({
    amount: Math.round(amount),
    currency,
    receipt: receipt || `mtr_${Date.now()}`,
  });

  const options = {
    hostname: 'api.razorpay.com',
    path: '/v1/orders',
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
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
    return res.status(data.status).json({ error: parsed.error?.description || 'Razorpay error' });
  }

  res.status(200).json({ id: parsed.id, amount: parsed.amount, currency: parsed.currency });
};
