import { config } from '../../config/env.js';
import { sendMail } from '../../lib/mailer.js';
import { compose, esc } from '../../lib/emailLayout.js';

const link = (path, token) => `${config.APP_URL}${path}?token=${encodeURIComponent(token)}`;

export const sendVerificationEmail = (user, token) =>
  sendMail({
    to: user.email,
    template: 'verify-email',
    subject: 'Verify your TeamFlow account',
    ...compose({
      greeting: `Hi ${user.firstName},`,
      lines: ['Confirm your email address to activate your TeamFlow account.'],
      action: 'Verify email address',
      url: link('/verify-email', token),
      footnote: "This link expires in 24 hours and can be used once. If you didn't create an account, you can ignore this email.",
    }),
  });

export const sendAlreadyRegisteredEmail = (user) =>
  sendMail({
    to: user.email,
    template: 'already-registered',
    subject: 'You already have a TeamFlow account',
    ...compose({
      greeting: `Hi ${user.firstName},`,
      lines: ['Someone tried to create a TeamFlow account with this email address. You already have an account.'],
      action: 'Sign in',
      url: `${config.APP_URL}/login`,
      footnote: `Forgot your password? Reset it at ${config.APP_URL}/forgot-password. If this wasn't you, you can ignore this email.`,
    }),
  });

export const sendPasswordResetEmail = (user, token) =>
  sendMail({
    to: user.email,
    template: 'reset-password',
    subject: 'Reset your TeamFlow password',
    ...compose({
      greeting: `Hi ${user.firstName},`,
      lines: ['We received a request to reset your TeamFlow password.'],
      action: 'Choose a new password',
      url: link('/reset-password', token),
      footnote: "This link expires in 30 minutes and can be used once. If you didn't request it, you can ignore this email — your password stays the same.",
    }),
  });

/** Security notice after any password change (reset link or Settings). Always sent; never contains the password. */
export const sendPasswordChangedEmail = (user, { via }) =>
  sendMail({
    to: user.email,
    template: 'password-changed',
    subject: 'Your TeamFlow password was changed',
    ...compose({
      greeting: `Hi ${user.firstName},`,
      lines: [
        via === 'reset'
          ? 'Your TeamFlow password was just reset with a link sent to this address. You were signed out on every device.'
          : 'Your TeamFlow password was just changed from your account settings. Other devices were signed out.',
        "If this was you, there's nothing more to do.",
        "If it wasn't you, reset your password now — that signs everyone else out — and tell your organization's administrator.",
      ],
      action: 'Reset my password',
      url: `${config.APP_URL}/forgot-password`,
      footnote: 'TeamFlow never asks for your password by email.',
    }),
  });

export const sendInvitationEmail = ({ user, organizationName, inviterName, roleName }, token) =>
  sendMail({
    to: user.email,
    template: 'invitation',
    subject: `${inviterName} invited you to ${organizationName} on TeamFlow`,
    ...compose({
      greeting: `Hi ${user.firstName},`,
      lines: [`${inviterName} invited you to join ${organizationName} on TeamFlow as ${roleName}.`],
      action: 'Accept invitation',
      url: link('/accept-invite', token),
      footnote: 'This invitation expires in 7 days.',
    }),
  });

/** Second factor for TeamFlow platform administrators: a code, not a link, so it can't be used by forwarding. */
export function sendPlatformLoginCode(admin, code) {
  const text = [
    `Hi ${admin.firstName},`,
    '',
    `Your TeamFlow platform sign-in code is: ${code}`,
    '',
    'It expires in 10 minutes and can be used once. If you did not try to sign in, change your password and tell the platform team.',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#161b26">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e3e6eb;border-radius:8px;overflow:hidden">
<tr><td style="background:#14295c;padding:16px 24px;color:#ffffff;font-size:18px;font-weight:bold">TeamFlow<span style="color:#f5b700">.</span> Platform</td></tr>
<tr><td style="padding:24px;font-size:14px;line-height:1.6">
<p style="margin:0 0 12px">Hi ${esc(admin.firstName)},</p>
<p style="margin:0 0 12px">Your platform sign-in code:</p>
<p style="margin:16px 0;font-size:28px;font-weight:bold;letter-spacing:6px;font-family:Consolas,monospace">${esc(code)}</p>
<p style="margin:16px 0 0;color:#556070;font-size:12px">It expires in 10 minutes and can be used once. If you did not try to sign in, change your password and tell the platform team.</p>
</td></tr></table></td></tr></table></body></html>`;
  return sendMail({ to: admin.email, template: 'platform-login-code', subject: `${code} is your TeamFlow platform sign-in code`, text, html });
}

/** Platform admin recovery link: 15 minutes, single use, opens the platform reset page (never the tenant one). */
export const sendPlatformPasswordResetEmail = (admin, token) =>
  sendMail({
    to: admin.email,
    template: 'platform-reset-password',
    subject: 'Reset your TeamFlow platform password',
    ...compose({
      greeting: `Hi ${admin.firstName},`,
      lines: ['We received a request to reset the password of your TeamFlow platform console account.'],
      action: 'Choose a new password',
      url: link('/platform/reset-password', token),
      footnote:
        "This link expires in 15 minutes and can be used once. Signing in will still need the code we email you. If you didn't request this, ignore this email — your password stays the same — and tell the platform team.",
    }),
  });

/** Security notice after a platform admin's password was reset. Never contains the password. */
export const sendPlatformPasswordChangedEmail = (admin) =>
  sendMail({
    to: admin.email,
    template: 'platform-password-changed',
    subject: 'Your TeamFlow platform password was changed',
    ...compose({
      greeting: `Hi ${admin.firstName},`,
      lines: [
        'The password of your TeamFlow platform console account was just reset with a link sent to this address. All platform sessions were signed out.',
        "If this was you, there's nothing more to do.",
        "If it wasn't you, reset your password again now and tell the platform team immediately.",
      ],
      action: 'Go to platform sign-in',
      url: `${config.APP_URL}/platform/login`,
      footnote: 'TeamFlow never asks for your password by email.',
    }),
  });
