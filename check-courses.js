const { chromium } = require("playwright");

(async () => {
  const edgeUserDataDir = process.env.LOCALAPPDATA + "\\Microsoft\\Edge\\User Data";
  const edgeExe = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const targetUrl = "https://gbpx.gd.gov.cn/gdceportal/study/StudyCenter.aspx";

  console.log("Launching Edge...");
  const context = await chromium.launchPersistentContext(edgeUserDataDir, {
    executablePath: edgeExe,
    headless: false,
    args: ["--profile-directory=Default"],
    viewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const page = context.pages()[0] || await context.newPage();

  console.log("Navigating to study center...");
  await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(5000);

  // Find the course list frame
  const frames = page.frames();
  let courseFrame = frames.find(f => f.url().includes("LearningCourse.aspx"));
  if (!courseFrame) {
    console.log("ERROR: Course frame not found");
    await context.close();
    return;
  }

  // Get all course info from the table
  const courseInfo = await courseFrame.evaluate(() => {
    const results = [];

    // Get tab info - 在学课程 vs 已学课程
    const tabs = document.querySelectorAll('li, a, span');
    const tabTexts = [];
    for (const tab of tabs) {
      const text = tab.textContent.trim();
      if (text.includes('在学课程') || text.includes('已学课程')) {
        tabTexts.push(text);
      }
    }

    // Get course rows from the table
    const rows = document.querySelectorAll('table tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 6) {
        const name = cells[0]?.textContent.trim();
        const hours = cells[1]?.textContent.trim();
        const type = cells[2]?.textContent.trim();
        const enrollDate = cells[3]?.textContent.trim();
        const progress = cells[4]?.textContent.trim();
        const action = cells[5]?.textContent.trim();
        if (name && name !== '课程名称' && !name.startsWith('共有')) {
          results.push({ name, hours, type, enrollDate, progress, action });
        }
      }
    }

    // Also check for pagination info
    const pagination = document.body.innerText.match(/共有\s*\d+\s*项/);

    return { tabs: tabTexts, courses: results, pagination: pagination?.[0] || '' };
  });

  console.log("\n=== 当前课程列表 ===");
  console.log("Tabs:", courseInfo.tabs.join(', '));
  console.log("Pagination:", courseInfo.pagination);
  console.log("");

  if (courseInfo.courses.length === 0) {
    console.log("当前没有在学课程（可能需要切换到'已学课程'查看完成的）");
    // Try clicking 已学课程 tab
    console.log("\n尝试查看已学课程...");
    const completedTab = await courseFrame.$('text=已学课程');
    if (completedTab) {
      await completedTab.click();
      await courseFrame.waitForTimeout(3000);

      const completedInfo = await courseFrame.evaluate(() => {
        const results = [];
        const rows = document.querySelectorAll('table tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 6) {
            const name = cells[0]?.textContent.trim();
            const hours = cells[1]?.textContent.trim();
            const type = cells[2]?.textContent.trim();
            const enrollDate = cells[3]?.textContent.trim();
            const progress = cells[4]?.textContent.trim();
            const action = cells[5]?.textContent.trim();
            if (name && name !== '课程名称' && !name.startsWith('共有')) {
              results.push({ name, hours, type, enrollDate, progress, action });
            }
          }
        }
        const pagination = document.body.innerText.match(/共有\s*\d+\s*项/);
        return { courses: results, pagination: pagination?.[0] || '' };
      });

      console.log("已学课程 (Pagination:", completedInfo.pagination + "):");
      for (const c of completedInfo.courses) {
        console.log(`  - ${c.name} | ${c.hours}学时 | ${c.type} | 进度: ${c.progress}`);
      }
    }
  } else {
    for (const c of courseInfo.courses) {
      console.log(`  - ${c.name}`);
      console.log(`    学时: ${c.hours} | 类型: ${c.type} | 选课: ${c.enrollDate}`);
      console.log(`    进度: ${c.progress} | 操作: ${c.action}`);
      console.log("");
    }
  }

  // Also check the left sidebar for available course categories
  const sidebarInfo = await page.frames().find(f => f.url().includes("secondHref"))?.evaluate(() => {
    const links = document.querySelectorAll('a, li, span');
    const items = [];
    for (const el of links) {
      const text = el.textContent.trim();
      if (text && text.length > 1 && text.length < 30 && !text.includes('cookie')) {
        items.push(text);
      }
    }
    return [...new Set(items)];
  }).catch(() => []);

  if (sidebarInfo && sidebarInfo.length > 0) {
    console.log("\n=== 侧边栏菜单 ===");
    for (const item of sidebarInfo) {
      console.log(" ", item);
    }
  }

  await page.screenshot({ path: "D:/test2/course-list.png", fullPage: false });
  console.log("\nScreenshot: D:/test2/course-list.png");

  // Keep open briefly
  await page.waitForTimeout(5000);
  await context.close();
})();
