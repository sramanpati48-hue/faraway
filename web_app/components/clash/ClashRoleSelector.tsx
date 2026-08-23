"use client";

import type { UserRole } from "@/lib/clashApi";
import { Gavel, Shield } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ClashRoleSelector({
  role,
  onChange,
}: {
  role: UserRole;
  onChange: (r: UserRole) => void;
}) {
  return (
    <Tabs
      value={role}
      onValueChange={(value) => {
        if (value === "prosecution" || value === "defence") onChange(value);
      }}
      className="w-full"
    >
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="prosecution" className="gap-2 px-3">
          <Gavel className="size-4 shrink-0" aria-hidden />
          Prosecutor
        </TabsTrigger>
        <TabsTrigger value="defence" className="gap-2 px-3">
          <Shield className="size-4 shrink-0" aria-hidden />
          Defence
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
