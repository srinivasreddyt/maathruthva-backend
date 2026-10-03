const { handle, getBody, normalizeIndianPhone, requireAdmin, sendError, HttpError } = require('../lib/security');
const { sendWhatsAppImage } = require('../lib/notify');

const STATUS_CAPTIONS = {
  dispatched: id => `🚚 Your order has been dispatched!\n\nOrder ID: ${id}\n\nIt's on its way to you. Thank you for shopping with Maathruthva!`,
  delivered: id => `📦 Your order has been delivered!\n\nOrder ID: ${id}\n\nWe hope you and your little one love it. Thank you for shopping with Maathruthva!`,
};

// Admin-triggered. Requires an admin Firebase session once ADMIN_EMAILS is configured.
module.exports = async (req, res) => {
  if (!handle(req, res, { name: 'send-status-whatsapp', max: 60 })) return;
  try {
    await requireAdmin(req);
    const { phone, orderId, status } = getBody(req);

    const to = normalizeIndianPhone(phone);
    if (!to || !/^[A-Za-z0-9_-]{3,64}$/.test(orderId || '')) throw new HttpError(400, 'Invalid phone or order id');
    const captionFn = Object.prototype.hasOwnProperty.call(STATUS_CAPTIONS, status) ? STATUS_CAPTIONS[status] : null;
    if (!captionFn) throw new HttpError(400, 'Unsupported status');

    const messageId = await sendWhatsAppImage({ to, caption: captionFn(orderId) });
    res.status(200).json({ success: true, messageId });
  } catch (e) {
    sendError(res, e);
  }
};
