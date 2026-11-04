export type Stance = "for" | "against";

export type DebateStatus = "active" | "archived";

export interface DatabaseProfile {
  id: string;
  display_name: string;
  created_at: string;
}

export interface DatabaseDebate {
  id: string;
  user_id: string;
  topic: string;
  user_stance: Stance;
  ai_stance: Stance;
  status: DebateStatus;
  created_at: string;
  updated_at: string;
}

export interface DatabaseMessage {
  id: string;
  debate_id: string;
  role: "user" | "ai";
  content: string;
  turn: number;
  created_at: string;
}

export interface Debate extends DatabaseDebate {
  messages: DatabaseMessage[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "ai";
  content: string;
  turn: number;
}
