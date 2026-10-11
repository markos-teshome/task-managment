/**
 * TeamFlow's email layout: navy header, short message, at most one clear button, plain-text twin.
 * Names, titles and organization names are user input, so everything placed into HTML is escaped.
 */
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function compose({ greeting, lines, action, url, footnote }) {
  const text = [`${greeting}`, '', ...lines, '', `${action}: ${url}`, '', footnote].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#161b26">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e3e6eb;border-radius:8px;overflow:hidden">
<tr><td style="background:#14295c;padding:16px 24px;color:#ffffff;font-size:18px;font-weight:bold">TeamFlow<span style="color:#f5b700">.</span></td></tr>
<tr><td style="padding:24px;font-size:14px;line-height:1.6">
<p style="margin:0 0 12px">${esc(greeting)}</p>
${lines.map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`).join('')}
<p style="margin:20px 0"><a href="${esc(url)}" style="background:#14295c;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold;display:inline-block">${esc(action)}</a></p>
<p style="margin:0 0 8px;color:#556070;font-size:12px">If the button doesn't work, copy this link into your browser:<br><a href="${esc(url)}" style="color:#24427a;word-break:break-all">${esc(url)}</a></p>
<p style="margin:16px 0 0;color:#556070;font-size:12px">${esc(footnote)}</p>
</td></tr></table>
<p style="color:#7b8494;font-size:11px;margin:12px 0 0">TeamFlow · Teamwork IT Solution PLC</p>
</td></tr></table></body></html>`;
  return { text, html };
}
