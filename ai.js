// AUREN v2.9.6 — conversation API with bounded verified context.
const KEY = 'auren_ai_endpoint_v1';
export function getAIEndpoint() { return localStorage.getItem(KEY) || ''; }
export function setAIEndpoint(value) {
  const url = String(value || '').trim().replace(/\/$/, '');
  if (url && !/^https:\/\/[a-z0-9.-]+\.workers\.dev$/i.test(url))
    throw new Error('Enter your Cloudflare Worker HTTPS address ending in .workers.dev');
  if (url) localStorage.setItem(KEY, url); else localStorage.removeItem(KEY);
  return url;
}
export async function askAI(message, memories = [], session = [], recent = [], deviceContext = []) {
  const endpoint = getAIEndpoint();
  if (!endpoint) throw new Error('Connect your free AI Worker under Memory & settings first.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const context = session.filter(x => typeof x === 'string').slice(0, 5);
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: String(message).slice(0, 1200),
        memories: memories.slice(0, 8).filter(m=>!m.sensitive).map(m => String(m.text || '').slice(0, 300)),
        session: context.map(x => x.slice(0, 200)),
        deviceContext: deviceContext.filter(x => typeof x === 'string').slice(0, 6).map(x => x.slice(0, 1800)),
        recent: recent.slice(-8)
      }), signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `AI service error (${response.status})`);
    if (typeof data.reply !== 'string') throw new Error('The AI service did not return a reply.');
    return data.reply.trim();
  } finally { clearTimeout(timeout); }
}
