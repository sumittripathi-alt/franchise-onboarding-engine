// Uptime check (G7.5). Reports whether the AI key is configured, never the key itself.
export async function GET() {
  return Response.json({ ok: true, geminiConfigured: Boolean(process.env.GEMINI_API_KEY) });
}
