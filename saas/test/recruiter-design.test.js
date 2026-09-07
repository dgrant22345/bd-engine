import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

const asset = name => readFile(new URL(`../../app/${name}`, import.meta.url), 'utf8');

test('recruiter workspace assets parse and share the shell cache version', async () => {
  const [people, html, worker] = await Promise.all([asset('people-workspace.js'), asset('index.html'), asset('sw.js')]);
  assert.doesNotThrow(() => new Script(people));
  const version = worker.match(/ASSET_VERSION = '([^']+)'/)[1];
  for (const file of ['app.js', 'local-api.js', 'people-workspace.js', 'styles.css', 'palette.css', 'workspace.css']) {
    assert.ok(html.includes(`/${file}?v=${version}`), `${file} needs a matching cache version`);
    assert.ok(worker.includes(`/${file}?v=`), `${file} must be in the offline shell`);
  }
  assert.ok(html.indexOf('/people-workspace.js?') < html.indexOf('/app.js?'));
});

test('people review keeps unsupported assessment and outreach claims out of defaults', async () => {
  const people = await asset('people-workspace.js');
  assert.match(people, /No candidate fit assessment has been made/);
  assert.match(people, /Drafts are not saved/);
  assert.match(people, /Replace the placeholders/);
  assert.match(people, /Have you actually sent your message/);
  assert.doesNotMatch(people, /pre-vetted|Verified & Available|\/api\/bootstrap/);
});
