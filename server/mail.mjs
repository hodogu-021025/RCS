// 인증번호 메일 발송 (Resend). 키가 없으면 개발 중에는 콘솔에 번호를 찍고, 운영에서는 발송을 거절한다
function emailHtml(code) {
  return `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f3f6fb;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#0f172a">
<div style="max-width:420px;margin:0 auto;background:#fff;border-radius:20px;padding:32px 28px">
  <div style="font-size:24px;font-weight:900;color:#007cfc;letter-spacing:-0.03em">Saylo</div>
  <p style="margin:20px 0 8px;font-size:16px;font-weight:700">이메일 인증번호</p>
  <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6">회원가입 화면에 아래 번호를 입력해 주세요. 번호는 5분 동안 쓸 수 있어요.</p>
  <div style="padding:18px 0;border-radius:14px;background:#f3f6fb;text-align:center;font-size:32px;font-weight:800;letter-spacing:8px;color:#007cfc">${code}</div>
  <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;line-height:1.6">직접 요청하지 않았다면 이 메일은 무시하셔도 됩니다.</p>
</div></body></html>`;
}

// 돌려주는 값: { mode: "resend" | "dev-console" | "off", sendMail(email, code) }
export function createMailer({ apiKey = "", from = "Saylo <onboarding@resend.dev>", production = false } = {}) {
  const mode = apiKey ? "resend" : production ? "off" : "dev-console";

  async function sendWithResend(email, code) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "[Saylo] 이메일 인증번호",
        html: emailHtml(code),
        text: `Saylo 이메일 인증번호: ${code}\n회원가입 화면에 입력해 주세요. 5분 동안 쓸 수 있어요.`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }

  async function sendMail(email, code) {
    if (mode === "resend") return sendWithResend(email, code);
    if (mode === "off") throw new Error("RESEND_API_KEY 가 설정되지 않았습니다");
    console.log(`[email:dev] ${email} 인증번호 ${code} (RESEND_API_KEY 가 없어 메일 대신 콘솔에 찍음)`);
  }

  const describe = { resend: `Resend (보내는 사람 ${from})`, off: "꺼짐 — .env 에 RESEND_API_KEY 필요", "dev-console": "개발용(콘솔 출력)" }[mode];
  return { mode, sendMail, describe };
}
