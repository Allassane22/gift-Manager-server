const nodemailer = require('nodemailer');

// ─── Transport Brevo SMTP ─────────────────────────────────────────────────────
// Créer un compte gratuit sur https://app.brevo.com
// Dashboard → SMTP & API → SMTP → copier host/port/login/password
// Variables .env requises :
//   BREVO_SMTP_HOST=smtp-relay.brevo.com
//   BREVO_SMTP_PORT=587
//   BREVO_SMTP_USER=votre@email.com
//   BREVO_SMTP_PASS=votre_smtp_password_brevo
//   EMAIL_FROM=DigiResell <no-reply@votredomaine.com>

const createTransport = () => {
  const { BREVO_SMTP_HOST, BREVO_SMTP_PORT, BREVO_SMTP_USER, BREVO_SMTP_PASS } = process.env;

  if (!BREVO_SMTP_HOST || !BREVO_SMTP_USER || !BREVO_SMTP_PASS) {
    throw new Error(
      'Email non configuré. Ajoutez BREVO_SMTP_HOST, BREVO_SMTP_USER et BREVO_SMTP_PASS dans .env\n' +
      'Créez un compte gratuit sur https://app.brevo.com (300 emails/jour offerts)'
    );
  }

  return nodemailer.createTransport({
    host: BREVO_SMTP_HOST,
    port: parseInt(BREVO_SMTP_PORT || '587', 10),
    secure: false, // STARTTLS sur le port 587
    auth: {
      user: BREVO_SMTP_USER,
      pass: BREVO_SMTP_PASS,
    },
  });
};

/**
 * Envoie un email de réinitialisation de mot de passe.
 * @param {string} toEmail   - Email du destinataire
 * @param {string} toName    - Nom du destinataire
 * @param {string} resetUrl  - Lien complet de reset (valable 15 min)
 */
const sendPasswordResetEmail = async (toEmail, toName, resetUrl) => {
  const transporter = createTransport();
  const from = process.env.EMAIL_FROM || 'DigiResell <no-reply@digiresell.com>';

  await transporter.sendMail({
    from,
    to: `${toName} <${toEmail}>`,
    subject: 'Réinitialisation de votre mot de passe DigiResell',
    text: `
Bonjour ${toName},

Vous avez demandé la réinitialisation de votre mot de passe DigiResell.

Cliquez sur ce lien pour choisir un nouveau mot de passe (valable 15 minutes) :
${resetUrl}

Si vous n'avez pas fait cette demande, ignorez cet email — votre mot de passe reste inchangé.

L'équipe DigiResell
    `.trim(),
    html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="background:#111827;padding:24px 32px;">
            <p style="margin:0;color:#ffffff;font-size:18px;font-weight:600;">DigiResell</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:600;">Réinitialisation du mot de passe</p>
            <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Bonjour ${toName},</p>
            <p style="margin:0 0 24px;color:#374151;font-size:14px;line-height:1.6;">
              Vous avez demandé la réinitialisation de votre mot de passe.<br>
              Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.<br>
              <strong>Ce lien expire dans 15 minutes.</strong>
            </p>
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="center">
                  <a href="${resetUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:14px;font-weight:600;">
                    Réinitialiser mon mot de passe
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">
              Si vous n'avez pas fait cette demande, ignorez cet email — votre mot de passe reste inchangé.<br>
              Ou copiez ce lien dans votre navigateur :<br>
              <span style="color:#6b7280;word-break:break-all;">${resetUrl}</span>
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #f3f4f6;">
            <p style="margin:0;color:#9ca3af;font-size:12px;">© ${new Date().getFullYear()} DigiResell. Tous droits réservés.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
    `.trim(),
  });
};

module.exports = { sendPasswordResetEmail };
