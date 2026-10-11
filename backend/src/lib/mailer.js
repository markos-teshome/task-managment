import nodemailer from 'nodemailer';
import { config } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Email delivery over SMTP (configured in .env; required outside automated tests).
 * Automated tests use an in-memory outbox instead, so they never send real email.
 */
export const testOutbox = [];

const smtp = config.isTest
  ? null
  : nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465, // implicit TLS on 465, STARTTLS otherwise
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
      
    });

/** Last start-up check, shown in the platform health view. */
export const mailerStatus = { verified: null, checkedAt: null };

/** Checks the SMTP connection and credentials (run at start-up). */
export async function verifyMailer() {
  if (!smtp) return true;
  try {
    await smtp.verify();
    logger.info({ host: config.SMTP_HOST }, 'SMTP connection verified');
    Object.assign(mailerStatus, { verified: true, checkedAt: new Date() });
    return true;
  } catch (err) {
    logger.error({ err: err.message, host: config.SMTP_HOST }, 'SMTP connection failed — emails cannot be sent');
    Object.assign(mailerStatus, { verified: false, checkedAt: new Date() });
    return false;
  }
}

/**
 * Sends one email. Returns true when the SMTP server accepted it, false otherwise.
 * Failures are logged (without content: it contains single-use links) and never thrown,
 * so callers decide what to tell the user.
 */
export async function sendMail({ to, subject, text, html, template }) {
  if (config.isTest) {
    testOutbox.push({ to, subject, text, html, template });
    return true;
  }
  try {
    const info = await smtp.sendMail({ from: config.MAIL_FROM, to, subject, text, html });
    const delivered = info.accepted?.length > 0;
    logger.info({ to, template, messageId: info.messageId, delivered }, 'Email sent');
    return delivered;
  } catch (err) {
    logger.error({ err: err.message, to, template }, 'Email delivery failed');
    return false;
  }
}
