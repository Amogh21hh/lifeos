import { expect, test } from "@playwright/test";

test("mobile: no horizontal scroll and bottom navigation works", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Enter the demo workspace" }).click();
  await expect(page).toHaveURL(/\/$/);
  for (const path of ["/", "/radar", "/decisions", "/finance"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(1);
  }
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Command" }).click();
  await expect(page).toHaveURL(/\/command/);
});
