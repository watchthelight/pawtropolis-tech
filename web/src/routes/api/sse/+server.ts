/**
 * SSE endpoint for browser clients.
 *
 * Holds a persistent connection open and streams events from the fan-out
 * system. Sends heartbeat comments every 30s to keep the connection alive
 * through Cloudflare and Nginx proxies.
 *
 * Authentication: requires valid session (event.locals.user).
 */

import type { RequestHandler } from "./$types";
import { addClient, removeClient, generateClientId } from "$lib/server/events/fan-out";

const HEARTBEAT_INTERVAL_MS = 30_000;

export const GET: RequestHandler = ({ locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const clientId = generateClientId();
  const encoder = new TextEncoder();
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        controller.enqueue(encoder.encode(data));
      };

      // Register with fan-out
      const accepted = addClient({
        id: clientId,
        userId: user.id,
        tier: user.tier,
        send,
      });

      if (!accepted) {
        controller.close();
        return;
      }

      // Initial heartbeat to confirm stream is live
      send(":heartbeat\n\n");

      // Periodic heartbeats to prevent proxy timeouts
      heartbeatTimer = setInterval(() => {
        try {
          send(":heartbeat\n\n");
        } catch {
          // Stream closed — cleanup will happen in cancel()
          if (heartbeatTimer) clearInterval(heartbeatTimer);
        }
      }, HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      // Client disconnected
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      removeClient(clientId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
};
