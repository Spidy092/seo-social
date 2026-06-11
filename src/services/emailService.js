const nodemailer = require('nodemailer');
const config = require('../config');
const { createLogger } = require('../utils/logger');

const log = createLogger('email-service');

let _transporter = null;

function getTransporter() {
    if (_transporter) return _transporter;

    if (!config.email.enabled) {
        throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env');
    }

    _transporter = nodemailer.createTransport({
        host: config.email.host,
        port: config.email.port,
        secure: config.email.secure,
        auth: {
            user: config.email.user,
            pass: config.email.pass,
        },
    });

    return _transporter;
}

/**
 * Send an email.
 * @param {Object} options
 * @param {string|string[]} options.to - Recipient email(s)
 * @param {string} options.subject - Email subject
 * @param {string} [options.text] - Plain text body
 * @param {string} [options.html] - HTML body
 * @param {Array} [options.attachments] - Nodemailer attachments
 * @returns {Promise<Object>} Nodemailer send result
 */
async function sendEmail({ to, subject, text, html, attachments }) {
    const transporter = getTransporter();
    const recipients = Array.isArray(to) ? to.join(', ') : to;

    const mailOptions = {
        from: config.email.from,
        to: recipients,
        subject,
        text: text || '',
        html: html || text || '',
    };

    if (attachments && attachments.length) {
        mailOptions.attachments = attachments;
    }

    log.info({ to: recipients, subject }, 'sending email');
    const result = await transporter.sendMail(mailOptions);
    log.info({ to: recipients, messageId: result.messageId }, 'email sent');
    return result;
}

/**
 * Verify SMTP connection is working.
 */
async function verifyConnection() {
    if (!config.email.enabled) {
        return { ok: false, error: 'SMTP not configured' };
    }
    try {
        const transporter = getTransporter();
        await transporter.verify();
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

module.exports = { sendEmail, verifyConnection };
