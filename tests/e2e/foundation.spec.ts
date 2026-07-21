import { expect, test } from "@playwright/test";

test("renders the TimeTree foundation without page errors or overflow", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("/");

  await expect(page).toHaveTitle("TimeTree");
  await expect(page.getByTestId("timetree-page")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Time, organized your way." })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(pageErrors).toEqual([]);
  expect(hasHorizontalOverflow).toBe(false);
});
