const { chromium } = require("playwright");

(async () => {
  const edgeUserDataDir = process.env.LOCALAPPDATA + "\\Microsoft\\Edge\\User Data";
  const edgeExe = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const targetUrl = "https://gbpx.gd.gov.cn/gdceportal/study/StudyCenter.aspx";

  console.log("Launching Edge with persistent context...");
  const context = await chromium.launchPersistentContext(edgeUserDataDir, {
    executablePath: edgeExe,
    headless: false,
    args: ["--profile-directory=Default"],
    viewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const page = context.pages()[0] || await context.newPage();

  console.log("Navigating to:", targetUrl);
  await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 60000 });

  // Wait for page to fully load
  await page.waitForTimeout(5000);

  // Take screenshot
  await page.screenshot({ path: "D:/test2/gbpx-study-page.png", fullPage: false });
  console.log("Screenshot saved to: D:/test2/gbpx-study-page.png");

  // Get page title and URL (after any redirects)
  const finalUrl = page.url();
  const title = await page.title();
  console.log("\nFinal URL:", finalUrl);
  console.log("Page title:", title);

  // Get all text content
  const pageText = await page.evaluate(() => document.body.innerText);

  // Look for login-related indicators
  console.log("\n=== Login Status Detection ===");

  // Check for common "not logged in" indicators
  const notLoggedInKeywords = [
    "请登录", "登录", "请先登录", "用户登录", "账号登录",
    "Sign in", "Login", "Log in", "请输入", "密码"
  ];

  // Check for "logged in" indicators
  const loggedInKeywords = [
    "欢迎", "退出", "注销", "个人中心", "我的课程", "学习中心",
    "用户名", "学员", "Welcome", "Logout", "Sign out", "我的学习"
  ];

  console.log("\n--- 'Logged in' indicators ---");
  let loginScore = 0;
  for (const kw of loggedInKeywords) {
    if (pageText.includes(kw)) {
      console.log(`  [FOUND] "${kw}"`);
      loginScore++;
    }
  }

  console.log("\n--- 'Not logged in' indicators ---");
  let notLoginScore = 0;
  for (const kw of notLoggedInKeywords) {
    if (pageText.includes(kw)) {
      console.log(`  [FOUND] "${kw}"`);
      notLoginScore++;
    }
  }

  // Check for iframes that might contain login forms
  const frames = page.frames();
  console.log("\n--- Frames ---");
  console.log("Number of frames:", frames.length);
  for (let i = 0; i < frames.length; i++) {
    console.log(`  Frame ${i}: ${frames[i].url()}`);
  }

  // Check cookies for the domain
  const cookies = await context.cookies();
  const siteCookies = cookies.filter(
    (c) => finalUrl.includes(c.domain.replace(/^\./, ""))
  );
  console.log("\n--- Cookies for this site ---");
  console.log("Total cookies:", siteCookies.length);
  for (const c of siteCookies) {
    console.log(`  ${c.name} = ${c.value.substring(0, 50)}${c.value.length > 50 ? "..." : ""} (${c.domain})`);
  }

  // Check for ASP.NET session cookies (common for .aspx sites)
  const aspNetCookies = siteCookies.filter(
    (c) =>
      c.name.toLowerCase().includes("asp") ||
      c.name.toLowerCase().includes("session") ||
      c.name.toLowerCase().includes("auth") ||
      c.name.toLowerCase().includes("token") ||
      c.name.toLowerCase().includes("ticket")
  );
  console.log("\n--- ASP.NET/Auth cookies ---");
  console.log("Count:", aspNetCookies.length);
  for (const c of aspNetCookies) {
    console.log(`  ${c.name} = ${c.value.substring(0, 80)}${c.value.length > 80 ? "..." : ""}`);
  }

  // If there are iframes, check their content too
  if (frames.length > 1) {
    console.log("\n--- Checking iframe content ---");
    for (let i = 1; i < frames.length; i++) {
      try {
        const frameText = await frames[i].evaluate(() => document.body?.innerText || "");
        if (frameText) {
          const snippet = frameText.substring(0, 300);
          console.log(`  Frame ${i} text preview: ${snippet}`);
        }
      } catch (e) {
        console.log(`  Frame ${i}: Cannot access (cross-origin)`);
      }
    }
  }

  // Final determination
  console.log("\n========================================");
  const hasSessionCookie = aspNetCookies.length > 0;
  const isLoggedIn = loginScore > notLoginScore || hasSessionCookie;

  console.log(`Login score: ${loginScore} (logged-in keywords)`);
  console.log(`Not-login score: ${notLoginScore} (login-form keywords)`);
  console.log(`Has session/auth cookies: ${hasSessionCookie}`);

  if (isLoggedIn) {
    console.log("RESULT: LOGGED IN");
  } else if (notLoginScore > loginScore) {
    console.log("RESULT: NOT LOGGED IN (login form detected)");
  } else {
    console.log("RESULT: UNCERTAIN (manual verification needed)");
  }
  console.log("========================================");

  console.log("\nBrowser stays open for 60s...");
  await page.waitForTimeout(60000);
  await context.close();
})();
