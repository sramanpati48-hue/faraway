"use client";

import type { ClashMockCase } from "@/lib/clashApi";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function MockCasePicker({
  cases,
  selectedId,
  onSelect,
}: {
  cases: ClashMockCase[];
  selectedId?: string;
  onSelect: (c: ClashMockCase) => void;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      role="listbox"
      aria-label="Mock cases"
    >
      {cases.map((c) => {
        const selected = selectedId === c.id;
        return (
          <button
            key={c.id}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => onSelect(c)}
            className="text-left"
          >
            <Card
              size="sm"
              className={cn(
                "h-full transition-all hover:shadow-md",
                selected
                  ? "ring-2 ring-primary bg-primary/5"
                  : "hover:border-primary/30"
              )}
            >
              <CardHeader className="pb-0">
                <CardTitle className="text-sm leading-snug">{c.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-2">
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {c.summary}
                </p>
                <div className="flex flex-wrap gap-1">
                  {c.tags.slice(0, 3).map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px]">
                      {t}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </button>
        );
      })}
    </div>
  );
}
