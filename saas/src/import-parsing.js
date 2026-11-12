// Parsing for user-supplied import files: LinkedIn/CRM contact exports and
// pasted or uploaded target-account lists. Kept free of store state so the
// rules can be unit tested directly.
//
// Real files vary far more than LinkedIn's own Connections.csv: spreadsheets
// saved in European locales use semicolons, pasted ranges use tabs, other
// tools name the same columns differently, and Excel writes Windows-1252 or
// UTF-16. The functions here absorb that variation and, when a file cannot be
// used, say exactly which column is missing instead of skipping every row.
import { parse as parseCsvSync } from 'csv-parse/sync';

const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'];
const HEADER_SCAN_ROWS = 15;

export const EXPECTED_CONTACT_HEADERS = ['First Name', 'Last Name', 'Company', 'Position'];

// Column names are compared after lowercasing, removing accents, and dropping
// everything except letters and digits ("E-mail Address" -> "emailaddress").
// Earlier aliases win when a file has several matching columns.
const CONTACT_COLUMN_ALIASES = {
  firstName: ['firstname', 'first', 'givenname', 'forename', 'prenom', 'vorname', 'voornaam'],
  lastName: ['lastname', 'last', 'surname', 'familyname', 'nom', 'nachname', 'achternaam', 'apellido', 'apellidos'],
  fullName: ['fullname', 'name', 'contactname', 'personname', 'contact'],
  company: [
    'company', 'companyname', 'currentcompany', 'organization', 'organisation', 'organizationname',
    'organisationname', 'employer', 'account', 'accountname', 'companynameforemails',
    'entreprise', 'societe', 'unternehmen', 'firma', 'empresa', 'bedrijf',
  ],
  position: [
    'position', 'title', 'jobtitle', 'currenttitle', 'currentposition', 'role', 'organizationtitle',
    'organisationtitle', 'headline', 'poste', 'titel', 'funktion', 'cargo', 'functie',
  ],
  email: ['emailaddress', 'email', 'workemail', 'primaryemail', 'email1value', 'emailaddress1'],
  linkedinUrl: [
    'url', 'profileurl', 'linkedinurl', 'linkedin', 'linkedinprofile', 'linkedinprofileurl',
    'personlinkedinurl', 'publicprofileurl',
  ],
  connectedOn: ['connectedon', 'connected', 'connectiondate', 'dateconnected'],
};

const ACCOUNT_COLUMN_ALIASES = {
  company: [
    // 'target' is deliberately absent: Target is a real employer name.
    'company', 'companyname', 'account', 'accountname', 'targetaccount', 'organization',
    'organisation', 'organizationname', 'organisationname', 'employer', 'name',
  ],
  domain: ['domain', 'companydomain', 'website', 'companywebsite', 'web', 'site', 'homepage', 'url'],
  careersUrl: ['careersurl', 'careers', 'careerspage', 'careerpage', 'careersite', 'jobsurl', 'jobspage'],
  priority: ['priority'],
  owner: ['owner', 'accountowner', 'assignedto'],
  notes: ['notes', 'note', 'comments', 'comment', 'description'],
  status: ['status', 'stage'],
};

function importError(message, code, extra = {}) {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  Object.assign(error, extra);
  return error;
}

export function canonicalColumnName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Maps each known field to the index of the first column whose name matches.
function mapColumns(headerCells, aliases) {
  const canonical = headerCells.map(canonicalColumnName);
  const columns = {};
  for (const [field, names] of Object.entries(aliases)) {
    for (const name of names) {
      const index = canonical.indexOf(name);
      if (index >= 0) {
        columns[field] = index;
        break;
      }
    }
  }
  return columns;
}

// Decodes an uploaded file. Excel saves "CSV" as Windows-1252 and "Unicode
// Text" as UTF-16, so assuming UTF-8 turns accented names into replacement
// characters or renders the whole file unreadable.
export function decodeUploadedText(input) {
  if (typeof input === 'string') return input.replace(/^\uFEFF/, '');
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (!bytes.length) return '';
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.subarray(3).toString('utf8');
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return swapUtf16(bytes.subarray(2)).toString('utf16le');

  // UTF-16 without a byte-order mark: mostly-ASCII text has a zero in every
  // other byte.
  const sampleLength = Math.min(bytes.length - (bytes.length % 2), 4096);
  if (sampleLength >= 8) {
    let evenZeros = 0;
    let oddZeros = 0;
    for (let index = 0; index < sampleLength; index += 2) {
      if (bytes[index] === 0) evenZeros += 1;
      if (bytes[index + 1] === 0) oddZeros += 1;
    }
    const pairs = sampleLength / 2;
    if (oddZeros > pairs * 0.4 && evenZeros < pairs * 0.1) return bytes.toString('utf16le');
    if (evenZeros > pairs * 0.4 && oddZeros < pairs * 0.1) return swapUtf16(bytes).toString('utf16le');
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('windows-1252').decode(bytes);
    } catch {
      return bytes.toString('latin1');
    }
  }
}

function swapUtf16(bytes) {
  const swapped = Buffer.from(bytes.subarray(0, bytes.length - (bytes.length % 2)));
  swapped.swap16();
  return swapped;
}

function countOutsideQuotes(line, delimiter) {
  let count = 0;
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') inQuotes = !inQuotes;
    else if (character === delimiter && !inQuotes) count += 1;
  }
  return count;
}

// Picks the delimiter that splits the most sample lines into the same number
// of columns. An Excel "sep=" directive on the first line always wins.
export function detectDelimiter(text) {
  const lines = String(text || '').slice(0, 65536).split(/\r\n|\r|\n/).filter((line) => line.trim()).slice(0, 25);
  if (!lines.length) return ',';
  const directive = /^sep=(.)$/i.exec(lines[0].trim());
  if (directive) return directive[1];

  let best = { delimiter: ',', lines: 0, columns: 0 };
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const tally = new Map();
    for (const line of lines) {
      const count = countOutsideQuotes(line, delimiter);
      if (count > 0) tally.set(count, (tally.get(count) || 0) + 1);
    }
    for (const [columns, lineCount] of tally) {
      if (lineCount > best.lines || (lineCount === best.lines && columns > best.columns)) {
        best = { delimiter, lines: lineCount, columns };
      }
    }
  }
  return best.delimiter;
}

function parseRecords(text, delimiter) {
  try {
    return parseCsvSync(String(text || ''), {
      bom: true,
      delimiter,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      max_record_size: 1_000_000,
    });
  } catch (cause) {
    throw importError(
      'CSV could not be parsed. Check the file format and try the original export again.',
      'invalid_csv',
      { cause, expectedHeaders: EXPECTED_CONTACT_HEADERS },
    );
  }
}

function listColumns(headerCells) {
  const names = headerCells.map((cell) => String(cell || '').trim()).filter(Boolean);
  const shown = names.slice(0, 8).join(', ');
  return names.length > 8 ? `${shown}, and ${names.length - 8} more` : shown;
}

// Finds the header row and maps its columns, or throws a 400 error that names
// what is missing.
function locateContactHeader(records) {
  // The header is the first early row that names at least two known columns,
  // one of them a name or company column. LinkedIn exports start with a notes
  // block, so the header is not always the first line.
  let headerIndex = -1;
  let columns = {};
  for (let index = 0; index < Math.min(HEADER_SCAN_ROWS, records.length); index += 1) {
    const candidate = mapColumns(records[index], CONTACT_COLUMN_ALIASES);
    const identifies = ['firstName', 'lastName', 'fullName', 'company'].some((field) => field in candidate);
    if (identifies && Object.keys(candidate).length >= 2) {
      headerIndex = index;
      columns = candidate;
      break;
    }
  }

  const expected = ['First Name', 'Last Name', 'Company', 'Position', 'Connected On', 'URL'];
  if (headerIndex < 0) {
    const firstRow = records.find((record) => record.some((cell) => String(cell || '').trim())) || [];
    throw importError(
      `This file does not look like a connections export. BD Engine needs a name column and a Company column, but found: ${listColumns(firstRow) || 'no column names'}.`,
      'unrecognized_columns',
      { expectedHeaders: expected, foundHeaders: firstRow.map((cell) => String(cell || '').trim()).filter(Boolean) },
    );
  }

  const headerCells = records[headerIndex];
  const hasName = 'firstName' in columns || 'lastName' in columns || 'fullName' in columns;
  const missingColumns = [];
  if (!hasName) missingColumns.push('First Name and Last Name (or Name)');
  if (!('company' in columns)) missingColumns.push('Company');
  if (missingColumns.length) {
    throw importError(
      `This file is missing a required column: ${missingColumns.join(' and ')}. Columns found: ${listColumns(headerCells)}.`,
      'missing_columns',
      { expectedHeaders: expected, missingColumns, foundHeaders: headerCells.map((cell) => String(cell || '').trim()).filter(Boolean) },
    );
  }
  return { headerIndex, columns };
}

// Cheap pre-flight for a file about to be queued: checks only the first part
// of the file for usable columns. Parse problems further in are left to the
// full import, which reports them with the same codes.
export function assertContactImportReadable(text) {
  const source = String(text || '');
  if (!source.trim()) return;
  let head = source.slice(0, 32768);
  if (head.length < source.length) head = head.slice(0, Math.max(head.lastIndexOf('\n'), 0));
  let records;
  try {
    records = parseRecords(head, detectDelimiter(head));
  } catch {
    return;
  }
  if (records.length >= 2) locateContactHeader(records);
}

// Reads a contact export into normalised rows. Throws a 400 error carrying a
// code and a plain-language message when the file cannot be used.
export function parseContactImport(text) {
  const source = String(text || '');
  const delimiter = detectDelimiter(source);
  const records = parseRecords(source, delimiter);
  if (records.length < 2) return { rows: [], delimiter, columns: {}, headerRow: 0 };

  const { headerIndex, columns } = locateContactHeader(records);
  const headerCells = records[headerIndex];

  const cell = (record, field) => (field in columns ? String(record[columns[field]] ?? '').trim() : '');
  const rows = records.slice(headerIndex + 1).map((record) => {
    let firstName = cell(record, 'firstName');
    let lastName = cell(record, 'lastName');
    if (!firstName && !lastName) {
      // A single "Name" column: the first word is the given name.
      const parts = cell(record, 'fullName').split(/\s+/).filter(Boolean);
      firstName = parts.shift() || '';
      lastName = parts.join(' ');
    }
    return {
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
      email: cell(record, 'email'),
      company: cell(record, 'company'),
      position: cell(record, 'position'),
      connectedOn: cell(record, 'connectedOn'),
      linkedinUrl: cell(record, 'linkedinUrl'),
    };
  });

  return {
    rows,
    delimiter,
    headerRow: headerIndex + 1,
    columns: Object.fromEntries(Object.entries(columns).map(([field, index]) => [field, String(headerCells[index] || '').trim()])),
  };
}

// Numbered ("1. Acme"), dashed ("- Acme"), bulleted, and quoted entries are how lists arrive when
// pasted from documents, email, and chat.
function cleanCompanyName(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^(?:[-*\u2022\u00b7\u2013\u2014]\s+|\d{1,3}[.)]\s+)/, '')
    .replace(/^"(.*)"$/, '$1')
    .replace(/""/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// A "Website" column usually holds a full address; accounts store the host.
function cleanDomain(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !raw.includes('/') && !/^www\./i.test(raw)) return raw;
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return parsed.hostname.replace(/^www\./i, '').toLowerCase() || raw;
  } catch {
    return raw;
  }
}

function looksLikeDomain(value) {
  return /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?$/i.test(String(value || '').trim());
}

// Reads a target-account list: one company per line, or a delimited table with
// a header row. Returns rows with the 1-based source line for error reporting.
export function parseAccountListText(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n');
  const lines = raw.split('\n');
  let firstIndex = lines.findIndex((line) => line.trim());
  if (firstIndex < 0) return [];

  let forcedDelimiter = '';
  const directive = /^sep=(.)$/i.exec(lines[firstIndex].trim());
  if (directive) {
    forcedDelimiter = directive[1];
    firstIndex = lines.findIndex((line, index) => index > firstIndex && line.trim());
    if (firstIndex < 0) return [];
  }

  // Is the first line a header? Try each delimiter and keep the reading that
  // recognises the most columns, as long as it names a company column.
  const headerLine = lines[firstIndex];
  let header = null;
  for (const delimiter of forcedDelimiter ? [forcedDelimiter] : ['\t', ';', ',', '|']) {
    let cells;
    try {
      [cells = []] = parseCsvSync(headerLine, { delimiter, relax_column_count: true, trim: true });
    } catch {
      continue;
    }
    const columns = mapColumns(cells, ACCOUNT_COLUMN_ALIASES);
    if (!('company' in columns)) continue;
    const recognised = Object.keys(columns).length;
    if (!header || recognised > header.recognised) header = { delimiter, columns, recognised, width: cells.length };
  }

  if (header && header.width > 1) {
    const body = lines.slice(firstIndex + 1);
    let records;
    try {
      records = parseCsvSync(body.join('\n'), {
        delimiter: header.delimiter,
        relax_column_count: true,
        relax_quotes: true,
        trim: true,
        skip_empty_lines: true,
        info: true,
      });
    } catch (cause) {
      throw importError('The list could not be read. Check for an unclosed quotation mark and try again.', 'invalid_csv', { cause });
    }
    const value = (record, field) => (field in header.columns ? String(record[header.columns[field]] ?? '').trim() : '');
    return records.map(({ record, info }) => ({
      line: firstIndex + 1 + info.lines,
      company: cleanCompanyName(value(record, 'company')),
      domain: cleanDomain(value(record, 'domain')),
      careersUrl: value(record, 'careersUrl'),
      priority: value(record, 'priority'),
      owner: value(record, 'owner'),
      notes: value(record, 'notes'),
      status: value(record, 'status'),
    }));
  }

  // One company per line. A lone header such as "Company" is skipped, and a
  // tab-separated second column is used as the domain when it looks like one.
  const startIndex = header ? firstIndex + 1 : firstIndex;
  const rows = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    if (!lines[index].trim()) continue;
    const [first, second = ''] = lines[index].split('\t');
    const company = cleanCompanyName(first);
    if (!company) continue;
    const row = { line: index + 1, company };
    if (looksLikeDomain(second)) row.domain = cleanDomain(second);
    rows.push(row);
  }
  return rows;
}
