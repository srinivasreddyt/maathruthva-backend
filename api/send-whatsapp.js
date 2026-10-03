const { handle, getBody, normalizeIndianPhone, sendError } = require('../lib/security');
const { getPaidOrder } = require('../lib/razorpay');
const { sendWhatsAppImage } = require('../lib/notify');

// Order confirmation. The recipient number comes from the paid Razorpay order, never from the request.
module.exports = async (req, res) => {
  if (!handle(req, res, { name: 'send-whatsapp', max: 10 })) return;
  try {
    const { razorpay_order_id } = getBody(req);
    const order = await getPaidOrder(razorpay_order_id);
    const to = normalizeIndianPhone((order.notes || {}).phone);
    if (!to) return res.status(200).json({ skipped: true });

    const messageId = await sendWhatsAppImage({
      to,
      caption: `Hello! Your order has been placed successfully with Maathruthva.\n\nOrder ID: ${order.id}\n\nThank you for shopping with us! We will deliver your order soon.`,
    });
    res.status(200).json({ success: true, messageId });
  } catch (e) {
    sendError(res, e);
  }
};
