import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertContactImportReadable,
  canonicalColumnName,
  decodeUploadedText,
  detectDelimiter,
  parseAccountListText,
  parseContactImport,
} from '../src/import-parsing.js';
import { createStore } from '../src/store.js';

const unlimitedPlan = { displayName: 'Unlimited', limits: { accounts: -1, contacts: -1 } };

function createTenant(tenantId) {
  const store = createStore();
  store.ensureTenant({ id: tenantId, name: tenantId }, { id: `${tenantId}-owner`, name: 'Owner' });
  return store;
}

test('uploaded files are decoded from UTF-8, Windows-1252, and UTF-16', () => {
  const text = 'First Name,Company\nJosé,Société Générale';
  assert.equal(decodeUploadedText(Buffer.from(text, 'utf8')), text);
  assert.equal(decodeUploadedText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])), text);
  // Excel "CSV (Comma delimited)" on Windows.
  assert.equal(decodeUploadedText(Buffer.from(text, 'latin1')), text);
  // Excel "Unicode Text", with and without a byte-order mark, both byte orders.
  const utf16le = Buffer.from(text, 'utf16le');
  const utf16be = Buffer.from(utf16le).swap16();
  assert.equal(decodeUploadedText(Buffer.concat([Buffer.from([0xff, 0xfe]), utf16le])), text);
  assert.equal(decodeUploadedText(Buffer.concat([Buffer.from([0xfe, 0xff]), utf16be])), text);
  assert.equal(decodeUploadedText(utf16le), text);
  assert.equal(decodeUploadedText(utf16be), text);
  assert.equal(decodeUploadedText(Buffer.alloc(0)), '');
  assert.equal(decodeUploadedText('﻿already text'), 'already text');
});

test('the delimiter is detected from the file rather than assumed', () => {
  assert.equal(detectDelimiter('First Name,Last Name,Company\nAna,Stone,Acme'), ',');
  assert.equal(detectDelimiter('First Name;Last Name;Company\nAna;Stone;Acme'), ';');
  assert.equal(detectDelimiter('First Name\tLast Name\tCompany\nAna\tStone\tAcme'), '\t');
  assert.equal(detectDelimiter('First Name|Last Name|Company\nAna|Stone|Acme'), '|');
  assert.equal(detectDelimiter('sep=;\nFirst Name;Company'), ';');
  // Commas inside values of a tab-separated file do not win.
  assert.equal(detectDelimiter('Name\tCompany\tTitle\nAna Stone\tAcme, Inc.\tVP, Talent\nBo Lee\tGlobex\tRecruiter'), '\t');
  // LinkedIn's quoted notes block contains commas but is not the table.
  assert.equal(detectDelimiter('Notes:\n"When exporting, you may notice, some emails are missing."\n\nFirst Name;Last Name;Company\nAna;Stone;Acme'), ';');
  assert.equal(detectDelimiter('Acme\nGlobex'), ',');
  assert.equal(detectDelimiter(''), ',');
});

test('column names are matched regardless of case, spacing, punctuation, and accents', () => {
  assert.equal(canonicalColumnName(' E-mail Address '), 'emailaddress');
  assert.equal(canonicalColumnName('FIRST_NAME'), 'firstname');
  assert.equal(canonicalColumnName('Prénom'), 'prenom');

  const variants = {
    'LinkedIn export': 'First Name,Last Name,URL,Email Address,Company,Position,Connected On\nAna,Stone,https://www.linkedin.com/in/ana,ana@acme.example,Acme,VP Talent,05 Jan 2024',
    'uppercase': 'FIRST NAME,LAST NAME,URL,EMAIL ADDRESS,COMPANY,POSITION,CONNECTED ON\nAna,Stone,https://www.linkedin.com/in/ana,ana@acme.example,Acme,VP Talent,05 Jan 2024',
    'snake case': 'first_name,last_name,profile_url,email,company_name,job_title,connected_on\nAna,Stone,https://www.linkedin.com/in/ana,ana@acme.example,Acme,VP Talent,05 Jan 2024',
    'Apollo': 'First Name,Last Name,Title,Company,Company Name for Emails,Email,Person Linkedin Url,Connected On\nAna,Stone,VP Talent,Acme,Acme Emails,ana@acme.example,https://www.linkedin.com/in/ana,05 Jan 2024',
    'single name column': 'Full Name;Job Title;Organization;LinkedIn URL;E-mail;Connected\nAna Stone;VP Talent;Acme;https://www.linkedin.com/in/ana;ana@acme.example;05 Jan 2024',
  };
  for (const [label, csv] of Object.entries(variants)) {
    const { rows } = parseContactImport(csv);
    assert.deepEqual(rows, [{
      firstName: 'Ana',
      lastName: 'Stone',
      fullName: 'Ana Stone',
      email: 'ana@acme.example',
      company: 'Acme',
      position: 'VP Talent',
      connectedOn: '05 Jan 2024',
      linkedinUrl: 'https://www.linkedin.com/in/ana',
    }], label);
  }
});

test('a single name column keeps multi-word surnames together', () => {
  const { rows, columns, headerRow } = parseContactImport('Name,Company\nMaria de la Cruz,Acme\nCher,Globex');
  assert.deepEqual(rows.map((row) => [row.firstName, row.lastName, row.fullName]), [
    ['Maria', 'de la Cruz', 'Maria de la Cruz'],
    ['Cher', '', 'Cher'],
  ]);
  assert.deepEqual(columns, { fullName: 'Name', company: 'Company' });
  assert.equal(headerRow, 1);
});

test('the header is found below the LinkedIn notes block', () => {
  const csv = [
    'Notes:',
    '"When exporting your connection data, you may notice that some of the email addresses are missing."',
    '',
    'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Ana,Stone,https://www.linkedin.com/in/ana,,Acme,VP Talent,05 Jan 2024',
  ].join('\r\n');
  const { rows, headerRow } = parseContactImport(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].company, 'Acme');
  assert.equal(headerRow, 3, 'blank lines are not counted as records');
});

test('an unusable contact file is rejected with the reason and the columns found', () => {
  assert.throws(() => parseContactImport('Colour,Size\nRed,Large'), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.code, 'unrecognized_columns');
    assert.match(error.message, /needs a name column and a Company column, but found: Colour, Size\./);
    assert.deepEqual(error.foundHeaders, ['Colour', 'Size']);
    return true;
  });
  assert.throws(() => parseContactImport('First Name,Last Name,Position\nAna,Stone,VP'), (error) => {
    assert.equal(error.code, 'missing_columns');
    assert.deepEqual(error.missingColumns, ['Company']);
    assert.match(error.message, /missing a required column: Company\. Columns found: First Name, Last Name, Position\./);
    return true;
  });
  assert.throws(() => parseContactImport('Company,Position\nAcme,VP'), (error) => {
    assert.equal(error.code, 'missing_columns');
    assert.deepEqual(error.missingColumns, ['First Name and Last Name (or Name)']);
    return true;
  });
  assert.throws(() => parseContactImport('First Name,Company\nAna,"Broken'), { code: 'invalid_csv' });
  // Empty and header-only input are left for the caller to describe.
  assert.deepEqual(parseContactImport('').rows, []);
  assert.deepEqual(parseContactImport('First Name,Last Name,Company').rows, []);
});

test('the pre-flight check reads only the start of the file', () => {
  assert.doesNotThrow(() => assertContactImportReadable(''));
  assert.doesNotThrow(() => assertContactImportReadable('First Name,Last Name,Company\nAna,Stone,Acme'));
  assert.throws(() => assertContactImportReadable('Colour,Size\nRed,Large'), { code: 'unrecognized_columns' });
  // A problem far into a large file is not this check's concern.
  const large = `First Name,Last Name,Company\n${'Ana,Stone,Acme\n'.repeat(5000)}Bo,Lee,"Broken`;
  assert.ok(large.length > 32768);
  assert.doesNotThrow(() => assertContactImportReadable(large));
});

test('target lists are read as plain lines, pasted lists, or delimited tables', () => {
  const names = (text) => parseAccountListText(text).map((row) => row.company);
  assert.deepEqual(names('Acme\n\nGlobex\r\nInitech'), ['Acme', 'Globex', 'Initech']);
  assert.deepEqual(names('1. Acme\n2) Globex\n- Initech\n• Umbrella\n* Hooli\n"Quoted, Inc."'), ['Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Quoted, Inc.']);
  // Commas in an unstructured list are part of the name.
  assert.deepEqual(names('Acme, Inc.\nGlobex Corporation'), ['Acme, Inc.', 'Globex Corporation']);
  // Names that begin with digits are not list numbering.
  assert.deepEqual(names('3M\n1-800-Flowers\n7-Eleven'), ['3M', '1-800-Flowers', '7-Eleven']);
  // A lone header is skipped; "Target" is an employer, not a header.
  assert.deepEqual(names('Company\nAcme\nGlobex'), ['Acme', 'Globex']);
  assert.deepEqual(names('Company Name\n"Acme, Inc."'), ['Acme, Inc.']);
  assert.deepEqual(names('Target\nWalmart'), ['Target', 'Walmart']);
  assert.deepEqual(parseAccountListText(''), []);
  assert.deepEqual(parseAccountListText('\n \n'), []);
});

test('target tables accept common column names and any delimiter', () => {
  const expected = [
    { line: 2, company: 'Acme', domain: 'acme.com', careersUrl: '', priority: '', owner: '', notes: '', status: '' },
    { line: 3, company: 'Globex', domain: 'globex.com', careersUrl: '', priority: '', owner: '', notes: '', status: '' },
  ];
  for (const text of [
    'company,domain\nAcme,acme.com\nGlobex,globex.com',
    'Company Name,Website\nAcme,https://www.acme.com/about\nGlobex,www.globex.com',
    'Company;Domain\nAcme;acme.com\nGlobex;globex.com',
    'Account Name\tWebsite\nAcme\thttp://acme.com\nGlobex\tglobex.com',
    'sep=;\nCompany;Domain\nAcme;acme.com\nGlobex;globex.com',
  ]) {
    const rows = parseAccountListText(text);
    const offset = text.startsWith('sep=') ? 1 : 0;
    assert.deepEqual(rows, expected.map((row) => ({ ...row, line: row.line + offset })), JSON.stringify(text));
  }

  const [full] = parseAccountListText('Company,Domain,Careers URL,Priority,Owner,Notes,Status\n"Acme, Inc.",acme.com,https://acme.com/careers,high,Dana,"Met at event, follow up",new');
  assert.deepEqual(full, {
    line: 2, company: 'Acme, Inc.', domain: 'acme.com', careersUrl: 'https://acme.com/careers',
    priority: 'high', owner: 'Dana', notes: 'Met at event, follow up', status: 'new',
  });

  // A tab-separated paste without a header: the second column is the domain.
  assert.deepEqual(parseAccountListText('Acme\tacme.com\nGlobex\tnot a domain'), [
    { line: 1, company: 'Acme', domain: 'acme.com' },
    { line: 2, company: 'Globex' },
  ]);
  // Source line numbers survive blank lines so skipped rows can be reported.
  assert.deepEqual(parseAccountListText('company,domain\n\nAcme,acme.com\n,missing.com').map((row) => [row.line, row.company]), [[3, 'Acme'], [4, '']]);
});

test('LinkedIn import accepts semicolon files with localized headers and full-name columns', async () => {
  const store = createTenant('tenant-import-eu');
  const csv = 'Vorname;Nachname;Firma;Position\nJosé;Muñoz;Société Générale;Directeur\nZoë;Kühn;Müller & Söhne GmbH;Recruiter';
  const result = await store.importLinkedInCSV('tenant-import-eu', csv, { plan: unlimitedPlan });
  assert.equal(result.ok, true);
  assert.equal(result.stats.contactsCreated, 2);
  assert.equal(result.stats.skipped, 0);
  const contacts = await store.findContacts('tenant-import-eu', { page: 1, pageSize: 10 });
  assert.deepEqual(contacts.items.map((item) => `${item.fullName} @ ${item.companyName}`).sort(), [
    'José Muñoz @ Société Générale',
    'Zoë Kühn @ Müller & Söhne GmbH',
  ]);
});

test('LinkedIn import reports unusable columns instead of skipping every row', async () => {
  const store = createTenant('tenant-import-columns');
  const result = await store.importLinkedInCSV('tenant-import-columns', 'Colour,Size\nRed,Large', { plan: unlimitedPlan });
  assert.equal(result.ok, undefined);
  assert.equal(result.code, 'unrecognized_columns');
  assert.deepEqual(result.foundHeaders, ['Colour', 'Size']);
  assert.ok(result.expectedHeaders.includes('Company'));

  await assert.rejects(
    store.startLinkedInCsvImport('tenant-import-columns', 'First Name,Last Name,Position\nAna,Stone,VP', { plan: unlimitedPlan }),
    { status: 400, code: 'missing_columns' },
  );
});

test('trackAll tracks every company in the file except the listed exclusions', async () => {
  const csv = 'First Name,Last Name,Company,Position\nAna,Stone,Acme,VP Talent\nBo,Lee,Globex,Recruiter\nCy,Park,Initech,Engineer';
  const tracked = async (options) => {
    const tenantId = `tenant-track-${Math.random().toString(36).slice(2)}`;
    const store = createTenant(tenantId);
    const result = await store.importLinkedInCSV(tenantId, csv, { plan: unlimitedPlan, ...options });
    assert.equal(result.ok, true);
    const accounts = await store.findAccounts(tenantId, { page: 1, pageSize: 10 });
    return accounts.items.filter((item) => item.tracked).map((item) => item.displayName).sort();
  };
  assert.deepEqual(await tracked({ trackAll: true }), ['Acme', 'Globex', 'Initech']);
  assert.deepEqual(await tracked({ trackAll: true, untrackedCompanies: ['GLOBEX', ' initech '] }), ['Acme']);
  assert.deepEqual(await tracked({ trackedCompanies: ['Globex'] }), ['Globex']);
  assert.deepEqual(await tracked({}), []);

  // A dry run reports the same selection without changing anything.
  const store = createTenant('tenant-track-preview');
  const preview = await store.importLinkedInCSV('tenant-track-preview', csv, { plan: unlimitedPlan, dryRun: true, trackAll: true, untrackedCompanies: ['Acme'] });
  assert.deepEqual(preview.companies.filter((company) => company.selected).map((company) => company.companyName).sort(), ['Globex', 'Initech']);
  assert.equal((await store.findAccounts('tenant-track-preview', { page: 1, pageSize: 10 })).items.length, 0);
});

test('target list import handles headers, delimiters, and list markers end to end', async () => {
  const store = createTenant('tenant-target-list');
  const first = await store.importAccountsList('tenant-target-list', 'Company Name;Website\nAcme;https://www.acme.com\n;missing.example\nGlobex;globex.com');
  assert.equal(first.count, 2);
  assert.deepEqual(first.skipped, [{ line: 3, reason: 'missing_company' }]);
  const second = await store.importAccountsList('tenant-target-list', '1. Acme\n2. Initech\nCompany');
  assert.equal(second.count, 2, 'a trailing word that happens to be a header name is still a company');
  assert.deepEqual(second.skipped, [{ line: 1, company: 'Acme', reason: 'duplicate' }]);
  const accounts = await store.findAccounts('tenant-target-list', { page: 1, pageSize: 10 });
  assert.deepEqual(accounts.items.map((item) => `${item.displayName}|${item.domain}`).sort(), ['Acme|acme.com', 'Company|', 'Globex|globex.com', 'Initech|']);
});

test('recruiting titles are counted as talent contacts', async () => {
  const store = createTenant('tenant-import-talent');
  const csv = [
    'First Name,Last Name,Company,Position',
    'Ana,Reyes,Northwind,Technical Recruiter',
    'Ben,Okafor,Northwind,Recruiting Manager',
    'Cy,Tran,Northwind,Head of Recruitment',
    'Di,Novak,Northwind,Talent Acquisition Partner',
    'Eli,Stone,Northwind,HR Business Partner',
    'Flo,Marsh,Northwind,Software Engineer',
    'Gus,Hale,Northwind,Chief Architect',
  ].join('\n');
  const preview = await store.importLinkedInCSV('tenant-import-talent', csv, { plan: unlimitedPlan, dryRun: true });
  const northwind = preview.companies.find((company) => company.companyName === 'Northwind');
  assert.equal(northwind.talentContactCount, 5);
});
