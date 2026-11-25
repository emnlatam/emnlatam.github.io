// Berkli Bot: answers questions about Berklee admissions using ONLY the saved page texts
// (tables berkli_pages / berkli_links) and always returns the links the answer came from.
// Signed-in users only. Gemini key: Deno.env GEMINI_API_KEY (same secret as emn-interview-summarize).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EMN_SUPABASE_URL = 'https://gpoddvcrsdkpgfmyniqu.supabase.co';
const MODELS = ['gemini-3.5-flash', 'gemini-3.7-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function gemini(prompt: string): Promise<string> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
  let res!: Response;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        },
      );
      if (res.ok) break;
      if (![429, 500, 503].includes(res.status)) break;
      await new Promise((r) => setTimeout(r, 800));
    }
    if (res.ok) break;
  }
  if (!res.ok) throw new Error(`Gemini API error: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const client = createClient(EMN_SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return json({ error: 'Not authenticated' }, 401);

    const body = await req.json();
    const question = String(body.question || '').trim().slice(0, 600);
    if (!question) return json({ error: 'Missing question' }, 400);
    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
    const histText = history
      .map((m: { role: string; text: string }) => `${m.role === 'bot' ? 'Bot' : 'User'}: ${String(m.text).slice(0, 500)}`)
      .join('\n');

    // 1) The pages are in English: turn the (maybe Spanish) question into English search words.
    const kw = await gemini(
      `Conversation so far:\n${histText || '(none)'}\n\nNew question: ${question}\n\n` +
        `Write 4 to 10 English keywords (single words, lowercase, separated by spaces) that would appear on the Berklee College of Music admissions page that answers the new question. Output only the keywords.`,
    );
    const terms = Array.from(new Set(kw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2)));
    const q = terms.join(' or ');

    // 2) Best matching pages (RLS: signed-in users can read).
    const { data: pages, error } = await client.rpc('berkli_search', { q, lim: 4 });
    if (error) throw new Error(error.message);
    if (!pages || pages.length === 0) {
      return json({
        answer: 'No encontré esa información en las páginas de admisión de Berklee que tengo guardadas. Prueba con otras palabras o escribe a admissions@berklee.edu.',
        sources: [],
      });
    }

    // 3) Answer only from those texts.
    const context = pages
      .map((p: { url: string; title: string; text: string }, i: number) => `[${i + 1}] ${p.url}\n${p.title}\n${p.text.slice(0, 9000)}`)
      .join('\n\n-----\n\n');
    const answer = await gemini(
      `You are Berkli Bot, an assistant for students of EMN preparing to apply to Berklee College of Music.\n` +
        `Answer ONLY with facts found in the PAGES below. Never invent dates, prices or requirements; copy numbers and dates exactly. ` +
        `If the pages do not contain the answer, say so plainly and suggest contacting Berklee admissions. ` +
        `Reply in the same language as the user's question (Spanish or English), short and clear. ` +
        `At the end write "Fuentes:" (or "Sources:") followed by the numbers of the pages you used, like [1][3]. Do not write URLs.\n\n` +
        `Conversation so far:\n${histText || '(none)'}\n\nQuestion: ${question}\n\nPAGES:\n${context}`,
    );

    const used = new Set<number>();
    for (const m of answer.matchAll(/\[(\d+)\]/g)) used.add(Number(m[1]));
    const sources = pages
      .map((p: { url: string; title: string }, i: number) => ({ n: i + 1, url: p.url, title: p.title }))
      .filter((s: { n: number }) => used.size === 0 || used.has(s.n));

    // 4) Other possible pages: every page where at least one of the words (or a stem of it) appears.
    const { data: rel } = await client.rpc('berkli_related', { q, lim: 40 });
    const inSources = new Set(sources.map((s: { url: string }) => s.url));
    const others = (rel || [])
      .filter((p: { url: string }) => !inSources.has(p.url))
      .map((p: { url: string; title: string }) => ({ url: p.url, title: p.title }));
    return json({ answer, sources, others });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
