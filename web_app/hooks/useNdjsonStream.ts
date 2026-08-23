"use client";

import { useCallback } from "react";

export type NdjsonHandler = (data: Record<string, unknown>) => void | Promise<void>;

export function useNdjsonStream() {
  const consumeStream = useCallback(
    async (response: Response, onEvent: NdjsonHandler) => {
      if (!response.body) throw new Error("No response body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            await onEvent(JSON.parse(trimmed));
          } catch {
            console.warn("NDJSON parse skip:", trimmed.slice(0, 80));
          }
        }
      }
      if (buffer.trim()) {
        try {
          await onEvent(JSON.parse(buffer.trim()));
        } catch {
          /* ignore trailing partial */
        }
      }
    },
    []
  );

  return { consumeStream };
}
