

// ===== Ticket Types =====

type ModmailTicketStatus = "open" | "closed";

export type ModmailTicket = {
  id: number;
  guild_id: string;
  user_id: string;
  app_code: string | null;
  review_message_id: string | null;
  thread_id: string | null;
  thread_channel_id: string | null;
  status: ModmailTicketStatus;
  created_at: string;
  closed_at: string | null;
};

// ===== Transcript Types =====

export type TranscriptLine = {
  timestamp: string; // ISO 8601 format
  author: "STAFF" | "USER";
  content: string;
};

