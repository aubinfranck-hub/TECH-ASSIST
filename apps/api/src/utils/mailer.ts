import nodemailer from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Aucun serveur d'envoi configuré en production : on refuse plutôt que de faire semblant d'envoyer. */
export class MailNotConfiguredError extends Error {
  constructor() {
    super("L'envoi d'email n'est pas configuré (SMTP_HOST manquant).");
  }
}

/** Boîte d'envoi en mémoire, uniquement en test, pour lire le code sans vrai email. */
export const testOutbox: Mail[] = [];

let transporter: nodemailer.Transporter | null = null;

function getTransporter(host: string) {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

/**
 * Envoi SMTP (Gmail, Brevo, Resend, OVH…) configuré par variables d'environnement :
 * SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM.
 * En développement sans SMTP, le message est affiché dans la console (jamais en production).
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    testOutbox.push(mail);
    return;
  }

  const host = process.env.SMTP_HOST;
  if (!host) {
    if (process.env.NODE_ENV === 'production') throw new MailNotConfiguredError();
    console.log(`[mail:dev] à ${mail.to} — ${mail.subject}\n${mail.text}`);
    return;
  }

  const from = process.env.MAIL_FROM ?? (process.env.SMTP_USER ? `Tech Assist <${process.env.SMTP_USER}>` : undefined);
  if (!from) throw new MailNotConfiguredError();
  await getTransporter(host).sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text });
}
