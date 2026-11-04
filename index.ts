// DebateForge AI edge function
// Generates debate arguments server-side so no API key is ever exposed to the frontend.
//
// Strategy for always-working AI responses:
//   1. If OPENAI_API_KEY is configured as an edge-function secret, use OpenAI
//      (gpt-4o-mini) for high-quality arguments.
//   2. Otherwise fall back to Pollinations AI (a free, keyless text-generation
//      endpoint) so the debate works out of the box with zero configuration.
//
// Request body:
//   { debateId: string, topic: string, userStance: "for"|"against",
//     aiStance: "for"|"against", history: Array<{role:"user"|"ai", content:string}> }
// Response:
//   { argument: string }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface HistoryMessage {
  role: "user" | "ai";
  content: string;
}

interface RequestBody {
  topic: string;
  userStance: "for" | "against";
  aiStance: "for" | "against";
  history: HistoryMessage[];
}

const FOR_LABEL = "in favor of";
const AGAINST_LABEL = "against";

function stanceLabel(stance: "for" | "against"): string {
  return stance === "for" ? FOR_LABEL : AGAINST_LABEL;
}

function buildSystemPrompt(body: RequestBody): string {
  const aiSide = stanceLabel(body.aiStance);
  return [
    `You are DebateForge AI, a skilled debate opponent.`,
    `The debate topic is: "${body.topic}"`,
    `You are arguing ${aiSide} this topic.`,
    `Your opponent is arguing ${stanceLabel(body.userStance)}.`,
    ``,
    `Rules:`,
    `- Always argue YOUR assigned side (${aiSide}), never concede or switch sides.`,
    `- Make one strong, well-reasoned argument per turn (3-6 sentences).`,
    `- Directly respond to your opponent's last point when there is one.`,
    `- Use evidence, logic, and examples. Stay on topic.`,
    `- Do not use markdown headings, bullet lists, or role tags.`,
    `- Output ONLY your argument text, nothing else.`,
  ].join("\n");
}

function buildUserPrompt(body: RequestBody): string {
  const history = body.history ?? [];
  const turns: string[] = [];

  if (history.length === 0) {
    turns.push(
      `This is the opening turn. Present your opening argument ${stanceLabel(body.aiStance)} the topic "${body.topic}".`,
    );
  } else {
    for (const msg of history) {
      const speaker = msg.role === "user" ? "Opponent" : "You";
      turns.push(`${speaker}: ${msg.content}`);
    }
    turns.push(
      `Respond to the opponent's last argument and reinforce your position ${stanceLabel(body.aiStance)} the topic.`,
    );
  }

  return turns.join("\n\n");
}

async function callOpenAI(body: RequestBody, apiKey: string): Promise<string> {
  const system = buildSystemPrompt(body);
  const userPrompt = buildUserPrompt(body);

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: system },
    // Map our history into OpenAI chat roles.
    ...body.history.map((m) => ({
      role: m.role === "user" ? "assistant" : "user", // opponent = assistant-from-our-pov flipped
      content: m.content,
    })),
    { role: "user", content: userPrompt },
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.7,
      max_tokens: 400,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${txt}`);
  }

  const data = await res.json();
  const argument = data?.choices?.[0]?.message?.content?.trim();
  if (!argument) throw new Error("OpenAI returned an empty response");
  return argument;
}

async function callPollinations(body: RequestBody): Promise<string> {
  const system = buildSystemPrompt(body);
  const userPrompt = buildUserPrompt(body);

  // Pollinations text endpoint (keyless). We send the full prompt and ask for
  // plain text back. This is a real LLM, not hardcoded text.
  const prompt = `${system}\n\n${userPrompt}`;
  const url =
    "https://text.pollinations.ai/" +
    encodeURIComponent(prompt) +
    "?model=openai";

  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "text/plain" },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Pollinations error ${res.status}: ${txt}`);
  }

  const text = (await res.text()).trim();
  if (!text) throw new Error("AI service returned an empty response");
  return text;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!body.topic || !body.userStance || !body.aiStance) {
      return new Response(
        JSON.stringify({ error: "Missing topic, userStance, or aiStance" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!["for", "against"].includes(body.userStance) || !["for", "against"].includes(body.aiStance)) {
      return new Response(
        JSON.stringify({ error: "Stances must be 'for' or 'against'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    let argument: string;

    try {
      if (openaiKey) {
        argument = await callOpenAI(body, openaiKey);
      } else {
        argument = await callPollinations(body);
      }
    } catch (aiErr) {
      const message = aiErr instanceof Error ? aiErr.message : String(aiErr);
      return new Response(
        JSON.stringify({
          error: "The AI service could not generate a response. Please try again.",
          detail: message,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ argument }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "Unexpected server error", detail: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
