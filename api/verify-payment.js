const crypto = require('crypto');
const { handle, getBody, safeEqual, sendError, HttpError } = require('../lib/security');
const { finalizeOrder } = require('../lib/orders');

module.exports = async (req, res) => {
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

    if (!safeEqual(expected, razorpay_signature)) {
      return res.status(400).json({ verified: false, error: 'Signature mismatch' });
    }

    // Save the order from the server so it cannot be edited in the browser. If this fails the Razorpay webhook retries it,
    // and `orderSaved: false` tells the page to fall back to saving it itself.
    let orderSaved = false;
    try {
      orderSaved = (await finalizeOrder(razorpay_order_id)).saved === true;
    } catch (e) {
      console.error('Order finalize failed:', e && e.message);
    }
    res.status(200).json({ verified: true, payment_id: razorpay_payment_id, orderSaved });
  } catch (e) {
    sendError(res, e);
  }
};
