"use client";

import { resolveSnsAccess, type SnsAccess } from "@/lib/snsAccess";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";

export function useSnsAccess(): SnsAccess {
  const authUser = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const profile = useProfileStore((s) => s.profile);
  return resolveSnsAccess({ authUser, authLoading, profile });
}
