import type { Prisma } from "@prisma/client";

import { deletePromoRedemptionAndAdjustCount } from "@/lib/promo";

export type DraftBookingForCleanup = {
  id: string;
  promoRedemption: { id: string; promoCodeId: string } | null;
};

export type DraftBookingDependentCleanupSummary = {
  bookingIds: string[];
  promoRedemptions: number;
  changeRequests: number;
  modifications: number;
};

export async function deleteDraftBookingDependents(
  tx: Prisma.TransactionClient,
  drafts: DraftBookingForCleanup[],
): Promise<DraftBookingDependentCleanupSummary> {
  const bookingIds = drafts.map((draft) => draft.id);
  if (bookingIds.length === 0) {
    return {
      bookingIds,
      promoRedemptions: 0,
      changeRequests: 0,
      modifications: 0,
    };
  }

  let promoRedemptions = 0;
  for (const draft of drafts) {
    if (draft.promoRedemption) {
      await deletePromoRedemptionAndAdjustCount(tx, draft.promoRedemption);
      promoRedemptions += 1;
    }
  }

  const changeRequestResult = await tx.bookingChangeRequest.deleteMany({
    where: { bookingId: { in: bookingIds } },
  });
  const modificationResult = await tx.bookingModification.deleteMany({
    where: { bookingId: { in: bookingIds } },
  });

  return {
    bookingIds,
    promoRedemptions,
    changeRequests: changeRequestResult.count,
    modifications: modificationResult.count,
  };
}
