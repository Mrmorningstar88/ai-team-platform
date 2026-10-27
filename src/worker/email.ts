// Outgoing email through Resend (https://resend.com). The key is a Cloudflare
// secret; without it the app still runs, it just cannot send email.

export interface Mail { to: string; subject: string; text: string; html: string }

export type SendMail = (mail: Mail) => Promise<boolean>;

export function resendSender(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): SendMail {
  return async (mail) => {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, ...mail }),
    });
    return res.ok;
  };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function resetMail(to: string, name: string, link: string): Mail {
  const hi = name ? `${name}, здравствуйте!` : "Здравствуйте!";
  return {
    to,
    subject: "Восстановление пароля",
    text: `${hi}\n\nЧтобы задать новый пароль, откройте ссылку (она действует 1 час):\n${link}\n\nЕсли вы не просили сменить пароль, просто удалите это письмо.`,
    html:
      `<p>${escapeHtml(hi)}</p><p>Чтобы задать новый пароль, нажмите на ссылку. Она действует 1 час.</p>` +
      `<p><a href="${escapeHtml(link)}">Задать новый пароль</a></p>` +
      `<p>Если вы не просили сменить пароль, просто удалите это письмо.</p>`,
  };
}
