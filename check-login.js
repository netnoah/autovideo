const { chromium } = require("playwright");

(async () => {
  // Edge user data directory
  const edgeUserDataDir = process.env.LOCALAPPDATA + "\\Microsoft\\Edge\\User Data";
  const edgeExe = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

  console.log("Launching Edge with persistent context...");
  console.log("User data dir:", edgeUserDataDir);

  const context = await chromium.launchPersistentContext(edgeUserDataDir, {
    executablePath: edgeExe,
    headless: false,
    args: [
      "--profile-directory=Default",
      "--disable-features=ThirdPartyStoragePartitioning",
    ],
    viewport: { width: 1280, height: 800 },
    no_viewport: false,
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const page = context.pages()[0] || await context.newPage();

  console.log("Navigating to Edge Addons page...");
  await page.goto("https://microsoftedge.microsoft.com/addons/search/playwright", {
    waitUntil: "networkidle",
    timeout: 60000,
  });

  // Wait for page to fully render
  await page.waitForTimeout(5000);

  // Take a screenshot for visual verification
  await page.screenshot({ path: "D:/test2/edge-addons-page.png", fullPage: false });
  console.log("Screenshot saved to: D:/test2/edge-addons-page.png");

  // Check for login indicators
  const hasSignInButton = await page.$('text=Sign in');
  const hasSignOutButton = await page.$('text=Sign out');
  const hasUserAvatar = await page.$('[class*="avatar"], [class*="userAvatar"], [class*="profilePic"]');

  // Get page text content
  const pageText = await page.evaluate(() => document.body.innerText);

  console.log("\n=== Edge Addons Page Login Status ===");
  console.log("URL:", page.url());
  console.log("Title:", await page.title());

  // Check cookies for Microsoft authentication
  const cookies = await context.cookies();
  const msCookies = cookies.filter(
    (c) =>
      c.domain.includes("microsoft") ||
      c.domain.includes("live") ||
      c.domain.includes("msauth") ||
      c.domain.includes("bing")
  );

  const authCookies = msCookies.filter(
    (c) =>
      c.name.toLowerCase().includes("auth") ||
      c.name.toLowerCase().includes("token") ||
      c.name.toLowerCase().includes("session") ||
      c.name.toLowerCase().includes("login") ||
      c.name.toLowerCase().includes("estssauth") ||
      c.name.toLowerCase().includes("passport")
  );

  console.log("\n--- Cookie Analysis ---");
  console.log("Total Microsoft domain cookies:", msCookies.length);
  console.log("Auth-related cookies:", authCookies.length);
  for (const c of authCookies) {
    console.log(`  ${c.name} @ ${c.domain} (secure: ${c.secure}, httpOnly: ${c.httpOnly})`);
  }

  // Check for login-related UI elements
  console.log("\n--- UI Indicators ---");
  console.log("'Sign in' text found:", !!hasSignInButton);
  console.log("'Sign out' text found:", !!hasSignOutButton);
  console.log("User avatar element found:", !!hasUserAvatar);

  // Look for account-related text
  const loginTexts = ["Sign in", "Sign out", "My add-ons", "Developer", "Account"];
  console.log("\n--- Relevant text on page ---");
  for (const text of loginTexts) {
    if (pageText.includes(text)) {
      console.log(`  Found: "${text}"`);
    }
  }

  // Final determination
  console.log("\n========================================");
  const isLoggedIn = authCookies.length > 0 || !!hasSignOutButton || !!hasUserAvatar;
  if (isLoggedIn) {
    console.log("RESULT: LOGGED IN (Microsoft account detected)");
  } else {
    console.log("RESULT: NOT LOGGED IN");
  }
  console.log("========================================");

  console.log("\nBrowser stays open for 60s for manual inspection...");
  await page.waitForTimeout(60000);

  await context.close();
})();
