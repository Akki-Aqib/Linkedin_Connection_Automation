/**
 * connect.js — LinkedIn Auto-Connect (Simple Version)
 *
 * What it does:
 *   1. Opens Chrome browser
 *   2. Logs into LinkedIn
 *   3. Goes to My Network page
 *   4. Clicks every "Connect" button it finds
 *   5. Sends each request WITHOUT a note
 *   6. Stops after MAX_CONNECTIONS limit
 *
 * Run: node automation/connect.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ╔══════════════════════════════════════╗
// ║   EDIT YOUR SETTINGS HERE            ║
// ╚══════════════════════════════════════╝
const LINKEDIN_EMAIL    = 'YOUR_EMAIL@gmail.com';   // ← paste your email
const LINKEDIN_PASSWORD = 'YOUR_PASSWORD';          // ← paste your password
const MAX_CONNECTIONS   = 20;                       // ← how many to send per run
const HEADLESS          = false;                    // ← false = see the browser window
// ══════════════════════════════════════════

// Paths
const LOG_FILE     = path.join(__dirname, '..', 'logs', 'activity.log');
const SESSION_FILE = path.join(__dirname, '..', 'data', 'session.json');

// Make sure folders exist
fs.mkdirSync(path.join(__dirname, '..', 'logs'), { recursive: true });
fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });

// Logger
function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`); } catch(e) {}
}

// Wait helper (random delay between min and max milliseconds)
function wait(minMs, maxMs = minMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  log('════════════════════════════════════════');
  log('  LinkedIn Auto-Connect — Starting      ');
  log(`  Target: ${MAX_CONNECTIONS} connections  `);
  log('════════════════════════════════════════');

  // ── 1. Launch Chrome browser ───────────────────────────────────────────────
  log('Launching Chrome browser...');
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--start-maximized',
    ],
  });

  // Load saved session to skip login on future runs
  const ctxOptions = {
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
  if (fs.existsSync(SESSION_FILE)) {
    ctxOptions.storageState = SESSION_FILE;
    log('Found saved session — will try to skip login.');
  }

  const context = await browser.newContext(ctxOptions);

  // Hide the fact that this is automated
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  // ── 2. Login to LinkedIn ───────────────────────────────────────────────────
  log('Opening LinkedIn login page...');
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await wait(2000, 3000);

  // Check if session is already active
  const currentUrl = page.url();
  const alreadyLoggedIn = currentUrl.includes('/feed') || currentUrl.includes('/mynetwork') || currentUrl.includes('/in/');

  if (alreadyLoggedIn) {
    log('✅ Already logged in (session reused)!');
  } else {
    log('Typing email...');
    await page.waitForSelector('#username', { timeout: 15000 });
    await page.click('#username');
    await page.fill('#username', '');
    for (const ch of LINKEDIN_EMAIL) {
      await page.type('#username', ch, { delay: Math.floor(Math.random() * 80) + 40 });
    }
    await wait(600, 1200);

    log('Typing password...');
    await page.click('#password');
    await page.fill('#password', '');
    for (const ch of LINKEDIN_PASSWORD) {
      await page.type('#password', ch, { delay: Math.floor(Math.random() * 80) + 40 });
    }
    await wait(600, 1200);

    log('Clicking Sign In...');
    await page.click('button[type="submit"]');
    await wait(4000, 6000);

    const postLoginUrl = page.url();
    log('URL after login: ' + postLoginUrl);

    // Handle CAPTCHA or phone verification
    if (postLoginUrl.includes('/checkpoint') || postLoginUrl.includes('/challenge') || postLoginUrl.includes('/verification')) {
      log('');
      log('⚠️  ══════════════════════════════════════════');
      log('⚠️  VERIFICATION REQUIRED!');
      log('⚠️  Please complete the verification manually');
      log('⚠️  in the browser window that just opened.');
      log('⚠️  Waiting up to 2 minutes...');
      log('⚠️  ══════════════════════════════════════════');
      log('');
      try {
        await page.waitForURL('**/feed/**', { timeout: 120000 });
      } catch(e) {
        log('Timed out waiting. Trying to continue anyway...');
      }
      await wait(3000, 4000);
    }

    // Final login check
    if (!page.url().includes('/feed') && !page.url().includes('/mynetwork') && !page.url().includes('/in/')) {
      log('❌ Login failed!');
      log('Current URL: ' + page.url());
      log('Please check: 1) Email correct? 2) Password correct? 3) No CAPTCHA pending?');
      await browser.close();
      process.exit(1);
    }

    log('✅ Logged in successfully!');

    // Save session for next run
    await context.storageState({ path: SESSION_FILE });
    log('Session saved — next run will skip login.');
  }

  // ── 3. Go to My Network ────────────────────────────────────────────────────
  log('');
  log('Navigating to My Network page...');
  await page.goto('https://www.linkedin.com/mynetwork/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await wait(3000, 5000);
  log('✅ On My Network page!');

  // ── 4. Click Connect buttons ───────────────────────────────────────────────
  log('');
  log(`Starting to send connection requests (max: ${MAX_CONNECTIONS})...`);
  log('────────────────────────────────────────');

  let totalSent  = 0;
  let scrolls    = 0;
  let emptyRounds = 0;
  const MAX_SCROLLS = 30; // safety limit to avoid infinite loop

  while (totalSent < MAX_CONNECTIONS && scrolls < MAX_SCROLLS) {

    // Find all visible Connect buttons
    const allButtons = await page.$$('button');
    const connectButtons = [];

    for (const btn of allButtons) {
      try {
        const label  = (await btn.getAttribute('aria-label') || '').toLowerCase();
        const text   = (await btn.innerText().catch(() => '')).trim().toLowerCase();
        const visible = await btn.isVisible().catch(() => false);
        const enabled = await btn.isEnabled().catch(() => false);

        if (!visible || !enabled) continue;

        if (
          label.includes('invite') ||
          label.includes('connect') ||
          text === 'connect'
        ) {
          connectButtons.push(btn);
        }
      } catch(e) {}
    }

    log(`Found ${connectButtons.length} Connect button(s) on screen.`);

    if (connectButtons.length === 0) {
      emptyRounds++;
      if (emptyRounds >= 4) {
        log('No more Connect buttons after scrolling. All done!');
        break;
      }
      // Scroll down to load more cards
      log(`Scrolling down to load more people... (scroll #${scrolls + 1})`);
      await page.mouse.wheel(0, 600);
      await wait(2000, 3000);
      scrolls++;
      continue;
    }

    emptyRounds = 0;

    // Process each button
    for (const btn of connectButtons) {
      if (totalSent >= MAX_CONNECTIONS) break;

      try {
        // Get name from aria-label for logging
        const label = await btn.getAttribute('aria-label') || '';
        const personName = label
          .replace(/invite/gi, '')
          .replace(/to connect/gi, '')
          .replace(/connect with/gi, '')
          .trim() || 'someone';

        log(`→ Connecting with: ${personName}`);

        // Scroll button into view
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await wait(400, 800);

        // Click the Connect button
        await btn.click();
        await wait(1500, 2500);

        // ── Handle the "Send / Add Note" modal ─────────────────────────
        let modalFound = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          const modal = await page.$('[role="dialog"]').catch(() => null);
          if (modal) { modalFound = true; break; }
          await wait(500, 800);
        }

        if (modalFound) {
          let clicked = false;

          // Option 1: "Send without a note" button (most common)
          const sendWithout = await page.$('button[aria-label="Send without a note"]').catch(() => null);
          if (sendWithout && await sendWithout.isVisible().catch(() => false)) {
            await sendWithout.click();
            clicked = true;
          }

          // Option 2: "Send now" button
          if (!clicked) {
            const sendNow = await page.$('button[aria-label="Send now"]').catch(() => null);
            if (sendNow && await sendNow.isVisible().catch(() => false)) {
              await sendNow.click();
              clicked = true;
            }
          }

          // Option 3: Any button containing "Send" text inside dialog
          if (!clicked) {
            const dialog = await page.$('[role="dialog"]').catch(() => null);
            if (dialog) {
              const btns = await dialog.$$('button');
              for (const b of btns) {
                const t = (await b.innerText().catch(() => '')).trim();
                if (t.toLowerCase().includes('send')) {
                  await b.click();
                  clicked = true;
                  break;
                }
              }
            }
          }

          if (!clicked) {
            // Escape out if we couldn't find the send button
            await page.keyboard.press('Escape');
            await wait(500, 800);
            log(`  ⚠️  Couldn't find Send button for ${personName}, skipped.`);
            continue;
          }

          await wait(1200, 2000);
        }

        // ── Success ────────────────────────────────────────────────────
        totalSent++;
        log(`  ✅ Sent! [${totalSent}/${MAX_CONNECTIONS}]`);

        // Random human-like pause between requests (5–12 seconds)
        const pauseSec = Math.floor(Math.random() * (12 - 5 + 1)) + 5;
        log(`  Pausing ${pauseSec}s...`);
        await wait(pauseSec * 1000, pauseSec * 1000 + 500);

      } catch (err) {
        log(`  ⚠️  Error: ${err.message.split('\n')[0]}`);
      }
    }

    // Scroll down after processing all visible buttons
    if (totalSent < MAX_CONNECTIONS) {
      log('Scrolling for more people...');
      await page.mouse.wheel(0, 700);
      await wait(2000, 3500);
      scrolls++;
    }
  }

  // ── 5. Summary ─────────────────────────────────────────────────────────────
  log('');
  log('════════════════════════════════════════');
  log(`  ✅ COMPLETE! Sent ${totalSent} connection requests.`);
  log(`  Log saved to: logs/activity.log`);
  log('════════════════════════════════════════');

  await wait(2000, 3000);
  await browser.close();
  process.exit(0);
}

main().catch(err => {
  log('FATAL ERROR: ' + err.message);
  process.exit(1);
});
