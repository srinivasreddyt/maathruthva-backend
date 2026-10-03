const { handle, getBody, isEmail, cleanText, requireAdmin, sendError, HttpError } = require('../lib/security');
const { sendEmail, statusHtml } = require('../lib/notify');

const STATUS_CONTENT = {
  dispatched: {
    subject: id => `Your Order Has Been Dispatched - ${id}`,
    heading: 'Order Dispatched!',
    message: 'Great news — your order is on its way to you.',
    emoji: '🚚',
  },
  delivered: {
    subject: id => `Your Order Has Been Delivered - ${id}`,
    heading: 'Order Delivered!',
    message: 'Your order has been delivered. We hope you and your little one love it!',
    emoji: '📦',
  },
};

// Admin-triggered. Requires an admin Firebase session once ADMIN_EMAILS is configured.
module.exports = async (req, res) => {
  if (!handle(req, res)) return;
  try {
    await requireAdmin(req);
    const { email, name, orderId, status } = getBody(req);

    if (!isEmail(email) || !/^[A-Za-z0-9_-]{3,64}$/.test(orderId || '')) throw new HttpError(400, 'Invalid email or order id');
    const content = Object.prototype.hasOwnProperty.call(STATUS_CONTENT, status) ? STATUS_CONTENT[status] : null;
    if (!content) throw new HttpError(400, 'Unsupported status');

    const id = await sendEmail({
      to: email.trim(),
      subject: content.subject(orderId),
      html: statusHtml({ ...content, name: cleanText(name, 80), orderId }),
    });
    res.status(200).json({ success: true, id });
  } catch (e) {
    sendError(res, e);
  }
};
