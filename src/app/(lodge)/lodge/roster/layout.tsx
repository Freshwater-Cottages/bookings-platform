import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasActiveHutLeaderAssignment } from "@/lib/hut-leader";
import { hasAnyActiveLodgePinSession } from "@/lib/lodge-pin-session";
import { isMemberLevelRole } from "@/lib/member-roles";

export default async function LodgeRosterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (session?.user) {
    if (session.user.role === "ADMIN" || session.user.role === "LODGE") {
      return <>{children}</>;
    }

    if (
      isMemberLevelRole(session.user.role) &&
      (await hasActiveHutLeaderAssignment(session.user.id))
    ) {
      return <>{children}</>;
    }
  }

  if (await hasAnyActiveLodgePinSession(session?.user?.id ?? null)) {
    return <>{children}</>;
  }

  redirect("/lodge/kiosk");
}
