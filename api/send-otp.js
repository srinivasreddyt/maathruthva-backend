module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone, otp } = req.body || {};
  if (!phone || !otp || !/^[6-9]\d{9}$/.test(phone) || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ error: 'Invalid phone or OTP' });
  }

  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server misconfigured: missing API key' });

  const url = `https://www.fast2sms.com/dev/bulkV2?authorization=${apiKey}&route=otp&variables_values=${otp}&flash=0&numbers=${phone}`;
  const response = await fetch(url);
  const data = await response.json();

  console.log('Fast2SMS response:', JSON.stringify(data));

  if (data.return) {
    return res.status(200).json({ success: true });
  } else {
    return res.status(502).json({ error: data.message || 'Failed to send OTP', details: data });
  }
};
