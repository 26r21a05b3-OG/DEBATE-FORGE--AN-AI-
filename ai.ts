import { supabase } from "@/lib/supabase";

export interface AiArgumentResponse {
  argument: string;
}

export class AiApiError extends Error {
  status: number;
  detail?: string;
  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

interface HistoryItem {
  role: "user" | "ai";
  content: string;
}

interface GenerateArgumentParams {
  topic: string;
  userStance: "for" | "against";
  aiStance: "for" | "against";
  history: HistoryItem[];
}

export async function generateArgument(
  params: GenerateArgumentParams,
): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new AiApiError("You must be signed in to debate.", 401);
  }

  const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/debate-ai`;

  let response: Response;
  try {
    response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        topic: params.topic,
        userStance: params.userStance,
        aiStance: params.aiStance,
        history: params.history,
      }),
    });
  } catch {
    throw new AiApiError(
      "Could not reach the debate server. Check your connection and try again.",
      0,
    );
  }

  if (!response.ok) {
    let payload: { error?: string; detail?: string } | null = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const message =
      payload?.error ??
      `The AI could not respond (error ${response.status}). Please try again.`;
    throw new AiApiError(message, response.status, payload?.detail);
  }

  let data: AiArgumentResponse | null = null;
  try {
    data = (await response.json()) as AiArgumentResponse;
  } catch {
    throw new AiApiError("Received an invalid response from the debate server.", response.status);
  }

  if (!data || typeof data.argument !== "string" || !data.argument.trim()) {
    throw new AiApiError("The AI returned an empty argument. Please try again.", response.status);
  }

  return data.argument;
}
