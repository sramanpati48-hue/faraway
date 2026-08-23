"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function CaseInputForm({
  title,
  facts,
  onTitleChange,
  onFactsChange,
  mode,
}: {
  title: string;
  facts: string;
  onTitleChange: (v: string) => void;
  onFactsChange: (v: string) => void;
  mode: "practice" | "real_life";
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="clash-title">Case title</Label>
        <Input
          id="clash-title"
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder={
            mode === "real_life"
              ? "Brief title of your incident"
              : "Custom mock case title"
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="clash-facts">
          {mode === "real_life" ? "Describe what happened" : "Case facts"}
        </Label>
        <Textarea
          id="clash-facts"
          value={facts}
          onChange={(e) => onFactsChange(e.target.value)}
          rows={6}
          placeholder={
            mode === "real_life"
              ? "Include dates, parties, amounts, and what outcome you seek..."
              : "Write the facts both sides will debate..."
          }
          className="min-h-[140px] resize-y"
        />
      </div>
    </div>
  );
}
