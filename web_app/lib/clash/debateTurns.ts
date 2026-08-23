import type { ClashEntry } from "@/hooks/useClashStream";
import type { AgentSide, UserRole } from "@/lib/clashApi";

export type DebateSpeaker = "prosecution" | "defence" | "judge" | "user";

function sideToSpeaker(side: AgentSide): DebateSpeaker | null {
  if (side === "system") return null;
  return side;
}

export type DebateTurn = {
  id: string;
  speaker: DebateSpeaker;
  content: string;
  lawSections?: string[];
  streaming?: boolean;
  phase?: string;
  entryKind: string;
};

export type ArchiveItem =
  | { id: string; kind: "turn"; turn: DebateTurn }
  | { id: string; kind: "meta"; label: string; content: string };

export function turnBadgeLabel(turn: DebateTurn): string | null {
  if (turn.entryKind === "reasoning") return "Reasoning";
  if (!turn.phase) return null;
  return turn.phase.replace(/_/g, " ");
}

function entryToTurn(entry: ClashEntry): DebateTurn | null {
  if (entry.kind === "reasoning") {
    const speaker = sideToSpeaker(entry.side);
    if (!speaker || !entry.content.trim()) return null;
    return {
      id: entry.id,
      speaker,
      content: entry.content.trim(),
      lawSections: entry.lawSections?.length ? entry.lawSections : undefined,
      phase: entry.phase,
      entryKind: "reasoning",
    };
  }
  if (entry.kind === "stream") {
    if (entry.side === "system") return null;
    const speaker = sideToSpeaker(entry.side);
    if (!speaker) return null;
    if (!entry.content.trim() && entry.finalized) return null;
    return {
      id: entry.id,
      speaker,
      content: entry.content,
      streaming: !entry.finalized,
      phase: entry.phase,
      entryKind: "stream",
    };
  }
  if (entry.kind === "cross_answer") {
    const speaker = sideToSpeaker(entry.side);
    if (!speaker || !entry.text.trim()) return null;
    return {
      id: entry.id,
      speaker,
      content: entry.text,
      phase: entry.phase,
      entryKind: "cross_answer",
    };
  }
  if (entry.kind === "answer") {
    if (!entry.text.trim()) return null;
    return {
      id: entry.id,
      speaker: "user",
      content: entry.text,
      phase: entry.phase,
      entryKind: "answer",
    };
  }
  if (entry.kind === "question" && !entry.answered) {
    if (entry.questionTarget === "user" || entry.userAction) return null;
    const speaker =
      entry.questionTarget === "prosecution"
        ? "prosecution"
        : entry.questionTarget === "defence"
          ? "defence"
          : sideToSpeaker(entry.side);
    if (!speaker || !entry.text.trim()) return null;
    return {
      id: entry.id,
      speaker,
      content: entry.text,
      phase: entry.phase,
      entryKind: "question",
    };
  }
  if (entry.kind === "judge_verdict" && entry.content.trim()) {
    return {
      id: entry.id,
      speaker: "judge",
      content: entry.content,
      streaming: entry.streaming,
      entryKind: "judge_verdict",
    };
  }
  return null;
}

export function entriesToDebateTurns(entries: ClashEntry[]): DebateTurn[] {
  const turns: DebateTurn[] = [];
  for (const entry of entries) {
    const turn = entryToTurn(entry);
    if (turn) turns.push(turn);
  }
  return turns;
}

function questionArchiveLabel(entry: Extract<ClashEntry, { kind: "question" }>): string {
  if (entry.answered) return "Question (answered)";
  if (entry.userAction === "argue") return "Your turn — present your case";
  if (entry.userAction === "ask") return "Cross-examination prompt";
  return "Question for counsel";
}

export function entriesToArchiveItems(entries: ClashEntry[]): ArchiveItem[] {
  const items: ArchiveItem[] = [];

  for (const entry of entries) {
    const turn = entryToTurn(entry);
    if (turn) {
      items.push({ id: turn.id, kind: "turn", turn });
      continue;
    }

    if (entry.kind === "question") {
      items.push({
        id: entry.id,
        kind: "meta",
        label: questionArchiveLabel(entry),
        content: entry.text,
      });
      continue;
    }
    if (entry.kind === "rag") {
      items.push({
        id: entry.id,
        kind: "meta",
        label: `Law on record · ${entry.side}`,
        content: entry.citations
          .map((c) => c.label || c.act_name || "Authority")
          .join("\n"),
      });
    } else if (entry.kind === "system") {
      items.push({
        id: entry.id,
        kind: "meta",
        label: "System",
        content: entry.content,
      });
    } else if (entry.kind === "round_score") {
      items.push({
        id: entry.id,
        kind: "meta",
        label: `Round score · ${entry.scores.phase || "bench"}`,
        content: entry.scores.bench_note || `Winner: ${entry.scores.round_winner}`,
      });
    } else if (entry.kind === "parameters") {
      items.push({
        id: entry.id,
        kind: "meta",
        label: "Evaluation parameters",
        content: entry.parameters.map((p) => p.label).join(", "),
      });
    } else if (entry.kind === "final") {
      items.push({
        id: entry.id,
        kind: "meta",
        label: "Final verdict",
        content: entry.result.mock_verdict,
      });
    }
  }

  return items;
}

export function speakerColumn(
  speaker: DebateSpeaker,
  userRole: UserRole
): "left" | "right" | "center" {
  if (speaker === "judge") return "center";
  const userOnLeft = userRole === "prosecution";
  if (isUserSide(speaker, userRole)) {
    return userOnLeft ? "left" : "right";
  }
  return userOnLeft ? "right" : "left";
}

export function speakerLabel(
  speaker: DebateSpeaker,
  userRole: UserRole
): string {
  if (speaker === "judge") return "Judge";
  if (speaker === "user") {
    const role = userRole === "prosecution" ? "Prosecutor" : "Defender";
    return `YOU | ${role}`;
  }
  if (speaker === "prosecution") {
    return userRole === "prosecution" ? "YOU | Prosecutor" : "AI | Prosecutor";
  }
  return userRole === "defence" ? "YOU | Defender" : "AI | Defender";
}

export function isUserSide(speaker: DebateSpeaker, userRole: UserRole): boolean {
  if (speaker === "user") return true;
  if (userRole === "prosecution") return speaker === "prosecution";
  return speaker === "defence";
}

export function opponentSide(userRole: UserRole): AgentSide {
  return userRole === "prosecution" ? "defence" : "prosecution";
}
