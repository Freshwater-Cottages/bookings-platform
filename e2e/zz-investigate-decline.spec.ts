import { test } from "@playwright/test";
import { storageStatePath } from "./helpers/auth";
import {
  bookSelfToReviewStep,
  confirmBookingToPaymentStep,
} from "./helpers/booking";
import { personas } from "./helpers/personas";
import { stayWindow } from "./helpers/stay-dates";
import { payWithCard, TEST_CARDS } from "./helpers/stripe";

// TEMP (#1224 investigation): drive a declined card to the pay step and dump
// every surface a decline could appear on — no assertions. Delete after use.
test.use({ storageState: storageStatePath(personas.booker.email) });

test("INVESTIGATE decline surfacing", async ({ page }) => {
  const logs: string[] = [];
  page.on("console", (m) => logs.push(`[console:${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

  const window = stayWindow(2);
  await bookSelfToReviewStep(page, personas.booker, window);
  await confirmBookingToPaymentStep(page);

  await payWithCard(page, TEST_CARDS.declined);

  // Give confirmPayment time to resolve and any error to render.
  await page.waitForTimeout(15000);

  const appErr = await page
    .locator('.bg-red-50, [class*="red-700"]')
    .allTextContents();
  const bodyText = await page.locator("body").innerText();
  const pageHits = bodyText
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l && /declin|error|invalid|email|fail|unable|processing|pay/i.test(l),
    );

  const frameErrs: string[] = [];
  for (const f of page.frames()) {
    if (!/stripe|js\.stripe/i.test(f.url())) continue;
    const errText = await f
      .locator('[id*="Error"], .p-Error, [role="alert"]')
      .allTextContents()
      .catch(() => [] as string[]);
    if (errText.length)
      frameErrs.push(`ERR ${f.url().slice(0, 50)} :: ${JSON.stringify(errText)}`);
    const fbody = await f
      .locator("body")
      .innerText()
      .catch(() => "");
    const fh = fbody
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && /declin|error|invalid|email|complete/i.test(l));
    if (fh.length)
      frameErrs.push(`BODY ${f.url().slice(0, 40)} :: ${JSON.stringify(fh)}`);
  }

  const frameInputs: string[] = [];
  for (const f of page.frames()) {
    if (!/stripe|js\.stripe/i.test(f.url())) continue;
    const els = await f
      .locator("input")
      .all()
      .catch(() => []);
    for (const el of els) {
      const a = await el
        .evaluate((n: HTMLInputElement) => ({
          name: n.name,
          type: n.type,
          placeholder: n.placeholder,
          al: n.getAttribute("aria-label"),
        }))
        .catch(() => null);
      if (a) frameInputs.push(JSON.stringify(a));
    }
  }

  const successVisible = await page
    .getByText("Payment successful!")
    .isVisible()
    .catch(() => false);
  const payNowVisible = await page
    .getByRole("button", { name: "Pay Now" })
    .isVisible()
    .catch(() => false);

  console.log("\n\n========== #1224 DECLINE INVESTIGATION ==========");
  console.log("APP_ERROR_BOX:", JSON.stringify(appErr));
  console.log("PAGE_HITS:", JSON.stringify(pageHits));
  console.log("FRAME_ERRORS:", JSON.stringify(frameErrs));
  console.log("FRAME_INPUTS:", JSON.stringify(frameInputs));
  console.log("SUCCESS_BANNER_VISIBLE:", successVisible);
  console.log("PAY_NOW_VISIBLE:", payNowVisible);
  console.log("CONSOLE_LOGS:\n" + logs.join("\n"));
  console.log("========== END #1224 ==========\n\n");
});
