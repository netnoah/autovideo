const { chromium } = require("playwright");

const CHECK_INTERVAL = 2 * 60 * 1000; // 2 minutes
const EDGE_DATA_DIR = process.env.LOCALAPPDATA + "\\Microsoft\\Edge\\User Data";
const EDGE_EXE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const STUDY_URL = "https://gbpx.gd.gov.cn/gdceportal/study/StudyCenter.aspx";

// --- Utility: wait with cancellation ---
function sleep(ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

// --- Try clicking play on a page and its frames ---
async function tryPlayVideo(page) {
  const selectors = [
    '.vjs-big-play-button',
    '.prism-big-play-btn',
    '.xgplayer-play',
    '[class*="play-btn"]',
    '[class*="playBtn"]',
    '[class*="big-play"]',
    '.video-play-btn',
    'button[aria-label="play"]',
    'button[aria-label="播放"]',
  ];
  const bottomSelectors = [
    '.vjs-play-control',
    '.vjs-control-bar .vjs-play-control',
    '[class*="control-bar"] [class*="play"]',
  ];

  // Strategy 1: main page selectors
  for (const sel of selectors) {
    try {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) {
        await btn.click();
        console.log(`  Clicked play: ${sel}`);
        return true;
      }
    } catch (_) {}
  }

  // Strategy 2: iframe selectors
  for (const frame of page.frames()) {
    if (frame === page) continue;
    try {
      for (const sel of selectors) {
        try {
          const btn = await frame.$(sel);
          if (btn && await btn.isVisible()) {
            await btn.click();
            console.log(`  Clicked play in iframe: ${sel}`);
            return true;
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  // Strategy 3: click center of video element
  try {
    const video = await page.$('video');
    if (video) {
      const box = await video.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        console.log("  Clicked center of video element");
        return true;
      }
    }
  } catch (_) {}

  // Strategy 4: JavaScript play()
  try {
    const played = await page.evaluate(() => {
      for (const v of document.querySelectorAll('video')) { v.play(); return true; }
      return false;
    });
    if (played) { console.log("  Triggered video.play() via JS"); return true; }
  } catch (_) {}

  // Strategy 5: bottom bar play
  for (const sel of bottomSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn) { await btn.click(); console.log(`  Clicked bottom bar: ${sel}`); return true; }
    } catch (_) {}
  }

  return false;
}

// --- Check if video is playing or finished ---
async function getVideoStatus(page) {
  // Try main page first, then frames
  const targets = [page, ...page.frames().filter(f => f !== page)];
  for (const target of targets) {
    try {
      const status = await target.evaluate(() => {
        for (const v of document.querySelectorAll('video')) {
          if (v.ended) return { ended: true, currentTime: v.currentTime, duration: v.duration };
          if (!v.paused && v.currentTime > 0) return { playing: true, currentTime: v.currentTime, duration: v.duration };
          if (v.paused && v.currentTime > 0) return { paused: true, currentTime: v.currentTime, duration: v.duration };
        }
        return { noVideo: true };
      });
      if (status && !status.noVideo) return status;
    } catch (_) { /* cross-origin */ }
  }
  return { noVideo: true };
}

// --- Wait for video to finish, checking every CHECK_INTERVAL ---
async function waitForVideoFinish(page, onTick) {
  console.log("  Monitoring playback...");
  while (true) {
    await sleep(CHECK_INTERVAL);
    const status = await getVideoStatus(page);
    const fmt = (s) => {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    if (status.noVideo) {
      console.log("  [tick] No video element detected");
    } else if (status.ended) {
      console.log(`  Video ended (${fmt(status.currentTime)}/${fmt(status.duration)})`);
      return true;
    } else if (status.playing) {
      console.log(`  [tick] Playing: ${fmt(status.currentTime)} / ${fmt(status.duration)}`);
      if (onTick) onTick(status);
    } else if (status.paused) {
      // Paused but not ended — might need to resume
      console.log(`  [tick] Paused at ${fmt(status.currentTime)}, trying to resume...`);
      const resumed = await tryPlayVideo(page);
      if (!resumed) {
        console.log("  Could not resume, video may have finished or hit an error");
        // Treat prolonged pause as potentially finished
      }
    }
  }
}

// --- Open study center, find course frame ---
async function openStudyCenter(page) {
  await page.goto(STUDY_URL, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(5000);

  const frames = page.frames();
  return frames.find(f => f.url().includes("LearningCourse.aspx"));
}

// --- Find and click "继续学习" or "开始学习", return the new video page ---
async function clickContinueStudy(courseFrame, context) {
  const btn = await courseFrame.$('a:has-text("继续学习"), a:has-text("开始学习")');
  if (!btn) return null;

  const text = await btn.textContent();
  console.log(`  Found '${text.trim()}' button`);
  await btn.click();
  console.log("  Waiting for video page...");

  // Wait for new tab or find existing video page
  const videoPage = await context.waitForEvent("page", { timeout: 15000 }).catch(() => null);
  if (!videoPage) {
    const allPages = context.pages();
    const vp = allPages.find(p => p.url().includes("shawcoder.xyz"));
    if (!vp) return null;
    return vp;
  }
  return videoPage;
}

// --- Close video page safely ---
async function closeVideoPage(context) {
  const videoPages = context.pages().filter(p =>
    p.url().includes("shawcoder.xyz") || p !== context.pages()[0]
  );
  for (const vp of videoPages) {
    try { await vp.close(); } catch (_) {}
  }
}

// --- Main loop ---
(async () => {
  console.log("=== Auto Study Script (Loop Mode) ===\n");

  // 1. Launch Edge
  console.log("Launching Edge...");
  const context = await chromium.launchPersistentContext(EDGE_DATA_DIR, {
    executablePath: EDGE_EXE,
    headless: false,
    args: ["--profile-directory=Default"],
    viewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const mainPage = context.pages()[0] || await context.newPage();

  let courseIndex = 0;

  while (true) {
    courseIndex++;
    console.log(`\n========== Course #${courseIndex} ==========`);

    // 2. Open study center and find course list frame
    console.log("Opening study center...");
    const courseFrame = await openStudyCenter(mainPage);
    if (!courseFrame) {
      console.log("ERROR: Course list frame not found. Stopping.");
      break;
    }

    // 3. Click "继续学习"
    console.log("Looking for '继续学习' or '开始学习' button...");
    const videoPage = await clickContinueStudy(courseFrame, context);
    if (!videoPage) {
      console.log("No '继续学习' or '开始学习' button found. All courses may be completed.");
      break;
    }

    // Wait for video page to load
    await videoPage.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
    await videoPage.waitForTimeout(5000);
    console.log("  Video page URL:", videoPage.url());

    // 4. Click play
    console.log("Starting video playback...");
    await videoPage.waitForTimeout(2000);
    const playClicked = await tryPlayVideo(videoPage);
    if (playClicked) {
      console.log("  Playback started!");
    } else {
      console.log("  WARNING: Could not auto-click play. Manual intervention may be needed.");
    }

    // 5. Monitor until video finishes
    try {
      await waitForVideoFinish(videoPage);
      console.log("  Video finished! Moving to next course...");
    } catch (e) {
      console.log("  Monitoring error:", e.message);
    }

    // 6. Close video page (ensure only one video at a time)
    console.log("  Closing video page...");
    await closeVideoPage(context);
    console.log("  Video page closed. Preparing for next course...");

    // Brief pause before next iteration
    await sleep(3000);
  }

  console.log("\n=== All courses completed ===");
  await mainPage.screenshot({ path: "D:/test2/all-done.png" });
  console.log("Screenshot saved: D:/test2/all-done.png");
  console.log("Browser stays open. Close manually when done.");

  // Keep browser open
  await sleep(600000);
  await context.close();
})();
