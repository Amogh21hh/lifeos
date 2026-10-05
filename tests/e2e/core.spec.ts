import { expect, test, type Page } from "@playwright/test";

async function enterDemo(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Enter the demo workspace" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.describe("LIFEOS core flows", () => {
  test("unauthenticated visitors are sent to login", async ({ page }) => {
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/login\?next=%2Fprojects/);
  });

  test("TODAY briefing explains its top action", async ({ page }) => {
    await enterDemo(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/GOOD (MORNING|AFTERNOON|EVENING)/);
    await expect(page.getByText("Highest-leverage actions")).toBeVisible();
    await expect(page.getByText("Leverage = impact × urgency × confidence ÷ effort").first()).toBeVisible();
    await expect(page.getByText("What would change this").first()).toBeVisible();
  });

  test("every main section renders", async ({ page }) => {
    await enterDemo(page);
    for (const [path, heading] of [
      ["/radar", "Your world, as one connected map"],
      ["/missing", "What am I missing?"],
      ["/opportunities", "Opportunities"],
      ["/projects", "Projects"],
      ["/decisions", "Decisions"],
      ["/goals", "Goals"],
      ["/people", "People"],
      ["/documents", "Documents"],
      ["/finance", "Finance"],
      ["/knowledge", "Knowledge"],
      ["/simulate", "What happens if…"],
      ["/weekly", "Weekly intelligence report"],
      ["/activity", "AI activity"],
      ["/settings", "Settings"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    }
  });

  test("command center proposes, and approval executes", async ({ page }) => {
    await enterDemo(page);
    await page.goto("/command?q=" + encodeURIComponent("Remember that I prefer hybrid roles"));
    await expect(page.getByText("MemoryAgent")).toBeVisible();
    const approve = page.getByRole("button", { name: "Approve & run" });
    await expect(approve).toBeVisible();
    await approve.click();
    await expect(page.getByText("executed", { exact: true })).toBeVisible();
    await page.goto("/knowledge?tab=memory");
    await expect(page.getByText("I prefer hybrid roles", { exact: false }).first()).toBeVisible();
  });

  test("hybrid search explains matches", async ({ page }) => {
    await enterDemo(page);
    await page.goto("/knowledge?q=" + encodeURIComponent("What projects demonstrate my Python skills?"));
    await expect(page.getByText("Evidences Python").first()).toBeVisible();
  });

  test("radar potential opportunity shows its reasoning", async ({ page }) => {
    await enterDemo(page);
    await page.goto("/radar");
    await expect(page.getByText("Why this exists")).toBeVisible();
    await expect(page.getByText("What could unlock it")).toBeVisible();
  });
});
