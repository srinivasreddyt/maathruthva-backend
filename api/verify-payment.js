const crypto = require('crypto');
const { handle, getBody, safeEqual, sendError, HttpError } = require('../lib/security');

module.exports = (req, res) => {
  if (!handle(req, res, { name: 'verify-payment', max: 30 })) return;
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = getBody(req);

    if (
      !/^order_[A-Za-z0-9]{6,40}$/.test(razorpay_order_id || '') ||
      !/^pay_[A-Za-z0-9]{6,40}$/.test(razorpay_payment_id || '') ||
      !/^[a-f0-9]{64}$/.test(razorpay_signature || '')
    ) {
      throw new HttpError(400, 'Missing or malformed payment fields');
    }
    if (!process.env.RAZORPAY_KEY_SECRET) throw new HttpError(500, 'Server misconfigured');

    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (safeEqual(expected, razorpay_signature)) {
      res.status(200).json({ verified: true, payment_id: razorpay_payment_id });
    } else {
      res.status(400).json({ verified: false, error: 'Signature mismatch' });
    }
  } catch (e) {
    sendError(res, e);
  }
};
