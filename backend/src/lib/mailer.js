import nodemailer from "nodemailer";
import { config } from "../config/env.js";
import { logger } from "./logger.js";
import { createBrevoSender } from "./brevo.js";

/**
 * Email delivery: Brevo's HTTPS API when BREVO_API_KEY is set (hosts that block SMTP ports), otherwise SMTP.
 * Automated tests use an in-memory outbox instead, so they never send real email.
 */
export const testOutbox = [];

const brevo =
  !config.isTest && config.BREVO_API_KEY
    ? createBrevoSender({
        apiKey: config.BREVO_API_KEY,
        from: config.MAIL_FROM,
      })
    : null;

const smtp =
  config.isTest || brevo
    ? null
    : nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_PORT === 465, // implicit TLS on 465, STARTTLS otherwise
        auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
        tls: {
          rejectUnauthorized: false,
        },
        // Fail within seconds when the mail server can't be reached (the default waits 2 minutes, so a request that
        // sends an email — e.g. an invitation — hung until the proxy gave up with a 502).
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });

/** Last start-up check, shown in the platform health view. */
export const mailerStatus = { verified: null, checkedAt: null };

/** Checks the email connection and credentials (run at start-up). */
export async function verifyMailer() {
  if (brevo) {
    const result = await brevo.verify();
    if (result.ok)
      logger.info({ sender: brevo.sender.email }, "Brevo email API verified");
    else
      logger.error(
        { err: result.error },
        "Brevo email API check failed — emails cannot be sent",
      );
    Object.assign(mailerStatus, { verified: result.ok, checkedAt: new Date() });
    return result.ok;
  }
  if (!smtp) return true;
  try {
    await smtp.verify();
    logger.info({ host: config.SMTP_HOST }, "SMTP connection verified");
    Object.assign(mailerStatus, { verified: true, checkedAt: new Date() });
    return true;
  } catch (err) {
    logger.error(
      { err: err.message, host: config.SMTP_HOST },
      "SMTP connection failed — emails cannot be sent",
    );
    Object.assign(mailerStatus, { verified: false, checkedAt: new Date() });
    return false;
  }
}

/**
 * Sends one email. Returns true when the provider (Brevo or the SMTP server) accepted it, false otherwise.
 * Failures are logged (without content: it contains single-use links) and never thrown,
 * so callers decide what to tell the user.
 */
export async function sendMail({ to, subject, text, html, template }) {
  if (config.isTest) {
    testOutbox.push({ to, subject, text, html, template });
    return true;
  }
  if (brevo) {
    const result = await brevo.send({ to, subject, text, html });
    if (result.ok)
      logger.info(
        { to, template, messageId: result.messageId, delivered: true },
        "Email sent",
      );
    else
      logger.error(
        { err: result.error, to, template },
        "Email delivery failed",
      );
    return result.ok;
  }
  try {
    const info = await smtp.sendMail({
      from: config.MAIL_FROM,
      to,
      subject,
      text,
      html,
    });
    const delivered = info.accepted?.length > 0;
    logger.info(
      { to, template, messageId: info.messageId, delivered },
      "Email sent",
    );
    return delivered;
  } catch (err) {
    logger.error({ err: err.message, to, template }, "Email delivery failed");
    return false;
  }
}
