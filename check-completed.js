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

  console.log("Navigating...");
  await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(5000);

  // Find the tab frame (thirdMain.html)
  const allFrames = page.frames();
  let tabFrame = allFrames.find(f => f.url().includes("thirdMain.html"));

  if (!tabFrame) {
    console.log("ERROR: tab frame (thirdMain.html) not found");
    await context.close();
    return;
  }

  console.log("Tab frame found:", tabFrame.url());

  // Get the full HTML structure of the tab area
  const tabHtml = await tabFrame.evaluate(() => {
    // Get all elements with text "已学课程" or "在学课程"
    const allElements = document.querySelectorAll('*');
    const results = [];
    for (const el of allElements) {
      // Only check leaf-ish elements (not parents that contain both tabs)
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim())
        .join('');
      const fullText = el.textContent.trim();

      if (fullText === '已学课程' || fullText === '在学课程') {
        results.push({
          tag: el.tagName,
          text: fullText,
          directText: directText,
          id: el.id,
          className: el.className,
          outerHTML: el.outerHTML.substring(0, 300),
          parentTag: el.parentElement?.tagName,
          parentClass: el.parentElement?.className,
          grandparentTag: el.parentElement?.parentElement?.tagName,
          grandparentClass: el.parentElement?.parentElement?.className,
        });
      }
    }
    return results;
  });

  console.log("\n=== Tab elements found ===");
  for (const t of tabHtml) {
    console.log(`  <${t.tag}> "${t.text}" (direct: "${t.directText}")`);
    console.log(`    id="${t.id}" class="${t.className}"`);
    console.log(`    parent: <${t.parentTag}> class="${t.parentClass}"`);
    console.log(`    HTML: ${t.outerHTML}`);
    console.log("");
  }

  // Find and click "已学课程" precisely
  console.log("Clicking '已学课程'...");
  const clickResult = await tabFrame.evaluate(() => {
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (el.textContent.trim() === '已学课程') {
        // Make sure this is the leaf element, not a parent
        const children = el.querySelectorAll('*');
        if (children.length > 0) continue; // skip parents

        el.click();
        return {
          tag: el.tagName,
          className: el.className,
          html: el.outerHTML.substring(0, 200),
        };
      }
    }
    return null;
  });

  if (clickResult) {
    console.log("Clicked:", clickResult);
  } else {
    console.log("WARNING: Could not find leaf '已学课程' element, trying broader match...");
    const fallback = await tabFrame.evaluate(() => {
      // Try clicking by class name
      const links = document.querySelectorAll('.thirdRouterLink');
      for (const el of links) {
        const text = el.textContent.trim();
        if (text.includes('已学课程')) {
          el.click();
          return { text: text.substring(0, 50), className: el.className };
        }
      }
      return null;
    });
    console.log("Fallback click:", fallback);
  }

  // Wait for the iframe to reload with completed courses
  console.log("\nWaiting for frame content to update...");
  await page.waitForTimeout(5000);

  // Check all frames for updated content
  const framesAfter = page.frames();
  console.log("\n=== Frames after click ===");
  for (let i = 0; i < framesAfter.length; i++) {
    const f = framesAfter[i];
    console.log(`Frame[${i}] ${f.url()}`);
    if (!f.url().startsWith('about:')) {
      try {
        const text = await f.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
        if (text) console.log(`  text: ${text.replace(/\n/g, ' | ')}`);
      } catch (e) {
        console.log(`  cross-origin or error`);
      }
    }
    console.log("");
  }

  // Look for the completed course data frame
  // It might be a new frame or the same LearningCourse frame with different URL params
  let courseFrame = null;
  for (const f of framesAfter) {
    const url = f.url();
    if (url.includes('LearningCourse') || url.includes('CompletedCourse') ||
        url.includes('completed') || url.includes('HistoryCourse') ||
        url.includes('history') || url.includes('FinishedCourse')) {
      courseFrame = f;
    }
  }

  // Also check frames that weren't there before
  const oldUrls = allFrames.map(f => f.url());
  const newFrames = framesAfter.filter(f => !oldUrls.includes(f.url()) && !f.url().startsWith('about:'));

  if (newFrames.length > 0) {
    console.log("=== New frames appeared ===");
    for (const f of newFrames) {
      console.log(`  ${f.url()}`);
      courseFrame = f; // likely this is the completed courses frame
    }
  }

  if (courseFrame) {
    console.log("\n=== Course data frame ===");
    console.log("URL:", courseFrame.url());

    const courseData = await courseFrame.evaluate(() => {
      const results = [];

      // Get all table rows
      const rows = document.querySelectorAll('table tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 4) {
          const cellData = [];
          for (const cell of cells) {
            cellData.push({
              text: cell.textContent.trim(),
              links: Array.from(cell.querySelectorAll('a')).map(a => ({
                text: a.textContent.trim(),
                href: a.href,
                onclick: a.getAttribute('onclick') || '',
              })),
            });
          }
          results.push(cellData);
        }
      }

      // Also get any list items
      const listItems = document.querySelectorAll('li');
      for (const li of listItems) {
        const text = li.textContent.trim();
        if (text.length > 10 && text.length < 200) {
          results.push([{ text: `[LI] ${text}`, links: [] }]);
        }
      }

      // Pagination info
      const pagination = document.body.innerText.match(/共有\s*\d+\s*项/);

      // All links on the page
      const allLinks = Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.textContent.trim().substring(0, 50),
        href: a.href.substring(0, 200),
      })).filter(l => l.text);

      return { rows: results, pagination: pagination?.[0] || '', links: allLinks };
    }).catch(() => ({ rows: [], pagination: '', links: [] }));

    console.log("Pagination:", courseData.pagination);
    console.log("\nLinks found:");
    for (const l of courseData.links) {
      console.log(`  "${l.text}" -> ${l.href}`);
    }
    console.log("\nTable data:");
    for (const row of courseData.rows) {
      const texts = row.map(c => c.text).join(' | ');
      if (texts.length > 10) {
        console.log(`  ${texts.substring(0, 200)}`);
        for (const c of row) {
          if (c.links.length > 0) {
            for (const link of c.links) {
              console.log(`    link: "${link.text}" -> ${link.href}`);
              if (link.onclick) console.log(`    onclick: ${link.onclick}`);
            }
          }
        }
      }
    }
  } else {
    console.log("No course data frame found. Let me check the thirdMain iframe for an embedded iframe...");
    // The tab frame might have an iframe inside it that loads the course list
    const innerFrameInfo = await tabFrame.evaluate(() => {
      const iframes = document.querySelectorAll('iframe');
      return Array.from(iframes).map(iframe => ({
        id: iframe.id,
        src: iframe.src,
        name: iframe.name,
      }));
    });
    console.log("Inner iframes in tab frame:", innerFrameInfo);
  }

  await page.screenshot({ path: "D:/test2/completed-courses.png" });
  console.log("\nScreenshot saved: D:/test2/completed-courses.png");

  // Keep open for manual inspection
  await page.waitForTimeout(10000);
  await context.close();
})();
