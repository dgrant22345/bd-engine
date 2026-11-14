// Run against an isolated, in-memory preview server, never a customer workspace.
// BD_CAMPAIGN_PREVIEW_URL=http://127.0.0.1:8795 node scripts/build-campaign-assets.mjs
//
// Writes the campaign graphics in the Bold dark look (November 2026):
// - social (1200 × 630) and square (1080 × 1080) cards for LinkedIn and link previews
// - Product Hunt gallery images (1270 × 760)
// - a square logo (400 × 400) for the LinkedIn Page, Discord server and directories
// - a LinkedIn Page cover (1128 × 191)
// Every product image is a labelled capture of public sample data.
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const preview = new URL(process.env.BD_CAMPAIGN_PREVIEW_URL || 'http://127.0.0.1:8795');
if (preview.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(preview.hostname)) {
  throw new Error('Campaign screenshots require a local preview server.');
}
const outputDir = fileURLToPath(new URL('../public/media/campaign/', import.meta.url));
await mkdir(outputDir, { recursive: true });
const asset = async (path) => (await readFile(new URL(path, import.meta.url))).toString('base64');
const mark = await asset('../public/brand-mark.svg');
const display = await asset('../public/fonts/space-grotesk-latin-wght-normal.woff2');
const text = await asset('../public/fonts/inter-latin-wght-normal.woff2');

const palette = { bg: '#0b0f14', surface: '#141b24', line: '#222b36', ink: '#f2f5f7', soft: '#c3ccd5', muted: '#9aa7b4', accent: '#c6f432', onAccent: '#0b0f14' };
const baseCss = `
  @font-face { font-family: 'Space Grotesk'; font-weight: 300 700; src: url(data:font/woff2;base64,${display}) format('woff2'); }
  @font-face { font-family: 'Inter'; font-weight: 100 900; src: url(data:font/woff2;base64,${text}) format('woff2'); }
  * { box-sizing: border-box; }
  body { margin: 0; background: ${palette.bg}; color: ${palette.ink}; font-family: Inter, Arial, sans-serif; }
  h1, .brand, .display { font-family: 'Space Grotesk', Inter, Arial, sans-serif; }
`;

const browser = await chromium.launch();
try {
  const screenshots = {};
  for (const [name, path] of [['recruiter', '/'], ['jobseeker', '/job-search'], ['audit', '/ats-checker'], ['today', '/']]) {
    const page = await browser.newPage({ viewport: { width: name === 'today' ? 1280 : 1440, height: 1000 }, reducedMotion: 'reduce' });
    await page.goto(new URL(path, preview).href);
    let panel = page.locator('.product-preview');
    if (name === 'audit') {
      await page.getByRole('button', { name: 'Try sample list' }).click();
      panel = page.locator('#checker-result');
    }
    if (name === 'today') {
      await page.locator('[data-demo-start]').first().click();
      const frame = page.frameLocator('iframe.cloud-app-frame');
      panel = frame.locator('.today-board');
      await panel.waitFor({ state: 'visible' });
      // The board's date line would date an evergreen graphic.
      await panel.locator('.eyebrow').evaluate((element) => element.remove());
    }
    await panel.waitFor({ state: 'visible' });
    await page.evaluate(() => globalThis.document.fonts.ready);
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
    today: {
      eyebrow: 'For independent recruiters',
      title: 'Who to call today.',
      description: 'Open roles at your companies, ranked with the people you already know.',
      cta: 'Explore the live demo',
      note: 'Read-only demo · 14-day free trial · $10 USD / month after',
      label: 'Sample workspace · Who to call today',
      wide: true,
    },
  };

  const card = (message, image, width, height, shape) => {
    const square = shape === 'square';
    const wide = Boolean(message.wide);
    const gallery = shape === 'gallery';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${baseCss}
      .card { width: ${width}px; height: ${height}px; padding: ${gallery ? '52px 60px' : '43px 48px'}; position: relative; overflow: hidden;
        background: radial-gradient(ellipse at 88% 18%, #c6f43222 0, transparent 46%), ${palette.bg}; }
      .brand { display: flex; gap: 12px; align-items: center; font-size: 27px; font-weight: 700; letter-spacing: -.3px; }
      .brand img { width: 42px; height: 42px; }
      .grid { display: grid; grid-template-columns: 1fr ${gallery ? 560 : 480}px; gap: 34px; align-items: center; margin-top: ${gallery ? 54 : 34}px; }
      .eyebrow { color: ${palette.accent}; font-size: 18px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; margin: 0 0 16px; }
      h1 { font-size: ${gallery ? 74 : 66}px; line-height: 1.02; letter-spacing: -2px; margin: 0 0 20px; font-weight: 700; }
      .description { font-size: 24px; line-height: 1.45; color: ${palette.soft}; margin: 0 0 26px; }
      .cta { display: inline-block; background: ${palette.accent}; color: ${palette.onAccent}; padding: 15px 24px; border-radius: 999px; font-size: 22px; font-weight: 700; }
      .proof { border: 1px solid ${palette.line}; padding: 12px; background: ${palette.surface}; border-radius: 18px; box-shadow: 0 24px 60px #0009; }
      .proof img { display: block; width: 100%; height: ${gallery ? 420 : 342}px; object-fit: contain; object-position: top; border-radius: 10px; }
      .proof p { margin: 10px 2px 2px; color: ${palette.muted}; font-size: 15px; line-height: 1.4; }
      footer { position: absolute; left: ${gallery ? 60 : 48}px; right: ${gallery ? 60 : 48}px; bottom: 28px; border-top: 1px solid ${palette.line}; padding-top: 16px; display: flex; justify-content: space-between; align-items: center; color: ${palette.muted}; font-size: 19px; }
      footer strong { color: ${palette.ink}; font-size: 21px; font-family: 'Space Grotesk', Inter, sans-serif; }
      ${wide ? `.grid { display: block; margin-top: 26px; } h1 { font-size: ${gallery ? 70 : 58}px; margin-bottom: 10px; } .description { margin-bottom: 18px; font-size: 22px; max-width: 760px; }
        .cta { position: absolute; right: ${gallery ? 60 : 48}px; top: ${gallery ? 50 : 40}px; font-size: 19px; padding: 12px 20px; }
        .proof { margin-top: 6px; } .proof img { height: ${square ? 560 : gallery ? 330 : 236}px; object-position: center top; }` : ''}
      ${square && !wide ? `.grid { display: block; margin-top: 37px; } h1 { font-size: 77px; margin-bottom: 15px; } .description { margin-bottom: 20px; } .proof { position: absolute; left: 490px; top: 400px; width: 510px; transform: rotate(-3deg); } .proof img { height: 426px; } .cta { margin-top: 10px; } .copy { width: 650px; } footer { bottom: 38px; }` : ''}
      ${square && wide ? `.cta { position: static; display: inline-block; margin-bottom: 30px; } h1 { font-size: 84px; } .description { font-size: 26px; } .grid { margin-top: 70px; } .proof img { height: auto; }` : ''}
    </style></head><body><main class="card">
      <div class="brand"><img src="data:image/svg+xml;base64,${mark}" alt="">BD Engine</div>
      <div class="grid"><div class="copy"><p class="eyebrow">${message.eyebrow}</p><h1>${message.title}</h1><p class="description">${message.description}</p><span class="cta">${message.cta} →</span></div>
      <div class="proof"><img src="data:image/png;base64,${image}" alt=""><p>${message.label}</p></div></div>
      <footer><span>${message.note}</span><strong>BD Engine</strong></footer>
    </main></body></html>`;
  };

  const render = async (html, width, height, file) => {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(html);
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.screenshot({ path: `${outputDir}/${file}` });
    await page.close();
  };

  let written = 0;
  for (const [name, message] of Object.entries(messages)) {
    const shapes = name === 'audit' ? ['social', 'gallery'] : name === 'jobseeker' ? ['social', 'square'] : ['social', 'square', 'gallery'];
    for (const shape of shapes) {
      const [width, height] = shape === 'square' ? [1080, 1080] : shape === 'gallery' ? [1270, 760] : [1200, 630];
      const file = shape === 'gallery' ? `gallery-${name}.png` : `${name}-${shape}.png`;
      await render(card(message, screenshots[name], width, height, shape), width, height, file);
      written += 1;
    }
  }

  // Square logo: the lime BD tile on the dark ground.
  await render(`<!doctype html><html><head><style>${baseCss} body { display: grid; place-items: center; width: 400px; height: 400px; }
    .tile { width: 400px; height: 400px; background: ${palette.accent}; display: grid; place-items: center; }
    .tile span { font-family: 'Space Grotesk', Inter, sans-serif; font-weight: 700; font-size: 168px; letter-spacing: -8px; color: ${palette.onAccent}; }
  </style></head><body><div class="tile"><span>BD</span></div></body></html>`, 400, 400, 'logo-400.png');
  written += 1;

  // LinkedIn Page cover: brand line on the left, a lime rule on the right.
  await render(`<!doctype html><html><head><style>${baseCss}
    /* LinkedIn places the Page logo over the lower left of the cover, so the text sits on the right. */
    .cover { width: 1128px; height: 191px; padding: 0 56px; display: flex; align-items: center; justify-content: flex-end; text-align: right;
      background: radial-gradient(ellipse 420px 160px at 18% 50%, #c6f4321f 0, transparent 70%), ${palette.bg}; }
    .line { font-family: 'Space Grotesk', Inter, sans-serif; font-size: 38px; font-weight: 700; letter-spacing: -1px; margin: 0; }
    .line em { font-style: normal; color: ${palette.accent}; }
    .sub { color: ${palette.soft}; font-size: 18px; margin: 8px 0 0; }
  </style></head><body><div class="cover"><div><p class="line">Know who to call <em>today.</em></p><p class="sub">Hiring signals, your own contacts and clear follow-ups for independent recruiters.</p></div></div></body></html>`, 1128, 191, 'linkedin-cover.png');
  written += 1;

  console.log(`Wrote ${written} campaign graphics to ${outputDir}`);
} finally {
  await browser.close();
}
