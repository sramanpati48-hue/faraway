"use client";

import type { ClashMode } from "@/lib/clashApi";
import { GraduationCap, Scale } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ClashModeSelector({
  mode,
  onChange,
}: {
  mode: ClashMode;
  onChange: (m: ClashMode) => void;
}) {
  return (
    <Tabs
      value={mode}
      onValueChange={(value) => {
        if (value === "practice" || value === "real_life") onChange(value);
      }}
      className="w-full sm:w-auto"
    >
      <TabsList className="grid w-full grid-cols-2 sm:w-[280px]">
        <TabsTrigger value="practice" className="gap-2 px-3">
          <GraduationCap className="size-4 shrink-0" aria-hidden />
          Practice
        </TabsTrigger>
        <TabsTrigger value="real_life" className="gap-2 px-3">
          <Scale className="size-4 shrink-0" aria-hidden />
          Real Life
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
