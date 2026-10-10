// Run against an isolated, in-memory preview server, never a customer workspace.
// BD_CAMPAIGN_PREVIEW_URL=http://127.0.0.1:8795 node scripts/build-campaign-assets.mjs
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const preview = new URL(process.env.BD_CAMPAIGN_PREVIEW_URL || 'http://127.0.0.1:8795');
if (preview.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(preview.hostname)) {
  throw new Error('Campaign screenshots require a local preview server.');
}
const outputDir = fileURLToPath(new URL('../public/media/campaign/', import.meta.url));
await mkdir(outputDir, { recursive: true });
const mark = (await readFile(new URL('../public/brand-mark.svg', import.meta.url))).toString('base64');
const browser = await chromium.launch();
try {
  const screenshots = {};
  for (const [name, path] of [['recruiter', '/'], ['jobseeker', '/job-search'], ['audit', '/ats-checker']]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(new URL(path, preview).href);
    let panel = page.locator('.product-preview');
    if (name === 'audit') {
      await page.getByRole('button', { name: 'Try sample list' }).click();
      panel = page.locator('#checker-result');
    }
    await panel.waitFor({ state: 'visible' });
    screenshots[name] = (await panel.screenshot()).toString('base64');
    await page.close();
  }

  const messages = {
    recruiter: {
      eyebrow: 'For independent recruiters',
      title: 'Know who to<br>call next.',
      description: 'Hiring context. Your contacts.<br>Clear follow-ups.',
      cta: 'Explore BD Engine',
      note: '$10 USD / month after a 14-day free trial',
      label: 'Sample recruiter workflow',
    },
    jobseeker: {
      eyebrow: 'For a focused job search',
      title: 'Give your job<br>search a plan.',
      description: 'Relevant public roles. Your network.<br>One clear next move.',
      cta: 'Start a 14-day free trial',
      note: '$5 USD / month after trial · No card to start',
      label: 'Sample job-search workflow',
    },
    audit: {
      eyebrow: 'Free ATS coverage audit',
      title: 'Check your<br>target list.',
      description: 'Recognize supported ATS hosts from<br>up to 50 career-site URLs.',
      cta: 'Run the free audit',
      note: 'No signup required · Export your results',
      label: 'Sample URLs · Recognition only; no live-job check',
    },
  };

  for (const [name, message] of Object.entries(messages)) {
    for (const shape of name === 'audit' ? ['social'] : ['social', 'square']) {
      const square = shape === 'square';
      const width = square ? 1080 : 1200;
      const height = square ? 1080 : 630;
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8">
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; color: #12243b; font-family: Arial, sans-serif; }
          .card { width: ${width}px; height: ${height}px; padding: 43px 48px; position: relative; overflow: hidden; background: #f4f8fc; }
          .card::after { content: ''; position: absolute; top: 0; right: 0; width: 15px; height: 100%; background: #10877e; }
          .brand { display: flex; gap: 12px; align-items: center; font-size: 27px; font-weight: 700; letter-spacing: -.5px; }
          .brand img { width: 42px; height: 42px; }
          .grid { display: grid; grid-template-columns: 1fr 480px; gap: 30px; align-items: center; margin-top: 38px; }
          .eyebrow { color: #0c6b66; font-size: 18px; font-weight: 700; margin: 0 0 17px; }
          h1 { font-size: 69px; line-height: 1.03; letter-spacing: -2.8px; margin: 0 0 22px; }
          .description { font-size: 25px; line-height: 1.5; color: #425872; margin: 0 0 26px; }
          .cta { display: inline-block; background: #0c706b; color: white; padding: 16px 23px; border-radius: 11px; font-size: 23px; font-weight: 700; }
          .proof { border: 1px solid #d5e2ec; padding: 13px; background: white; border-radius: 19px; box-shadow: 0 15px 40px #12243b16; align-self: center; }
          .proof img { display: block; width: 100%; height: 342px; object-fit: contain; object-position: top; }
          .proof p { margin: 12px 0 2px; color: #52647a; font-size: 16px; line-height: 1.4; }
          footer { position: absolute; left: 48px; right: 48px; bottom: 30px; border-top: 1px solid #d5e2ec; padding-top: 18px; display: flex; justify-content: space-between; align-items: center; color: #425872; font-size: 19px; }
          footer strong { color: #12243b; font-size: 22px; }
          ${square ? `.grid { display: block; margin-top: 37px; } h1 { font-size: 77px; margin-bottom: 15px; } .description { margin-bottom: 20px; } .proof { position: absolute; left: 490px; top: 400px; width: 510px; transform: rotate(-3deg); } .proof img { height: 426px; } .cta { margin-top: 10px; } .copy { width: 650px; } footer { bottom: 38px; }` : ''}
        </style></head><body><main class="card">
          <div class="brand"><img src="data:image/svg+xml;base64,${mark}" alt="">BD Engine</div>
          <div class="grid"><div class="copy"><p class="eyebrow">${message.eyebrow}</p><h1>${message.title}</h1><p class="description">${message.description}</p><span class="cta">${message.cta} →</span></div>
          <div class="proof"><img src="data:image/png;base64,${screenshots[name]}" alt=""><p>${message.label}</p></div></div>
          <footer><span>${message.note}</span><strong>BD Engine</strong></footer>
        </main></body></html>`);
      await page.screenshot({ path: `${outputDir}/${name}-${shape}.png` });
      await page.close();
    }
  }
  console.log(`Wrote 5 campaign graphics to ${outputDir}`);
} finally {
  await browser.close();
}
