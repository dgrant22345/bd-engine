import { performance } from 'node:perf_hooks';

// Simulate batch draft generator benchmarking 500 contacts
function benchmarkBatchEngine() {
  const count = 500;
  const dummyItems = Array.from({ length: count }, (_, i) => ({
    name: `Executive Contact ${i + 1}`,
    firstName: `Contact${i + 1}`,
    company: `High Growth Tech ${i + 1}`,
    title: `VP of Engineering ${i + 1}`,
    jobTitle: `Principal Distributed Systems Engineer`,
    jobLocation: 'San Francisco, CA / Remote',
    email: `exec${i + 1}@techcorp.io`,
    linkedinUrl: `https://linkedin.com/in/exec-${i + 1}`,
  }));

  const start = performance.now();
  const drafts = dummyItems.map(item => {
    const firstName = item.firstName;
    const companyName = item.company;
    const jobTitle = item.jobTitle;
    const myName = 'Alex Mercer';
    const subject = `${companyName} hiring sprint & talent capacity`;
    const body = `Hi ${firstName},\n\nNoticed ${companyName}'s active hiring expansion across your teams (especially around ${jobTitle}).\n\nWhen hiring picks up this quickly, talent teams usually run into candidate pipeline bottlenecks or niche sourcing bandwidth limits.\n\nWe specialize in supplying pre-vetted, highly qualified talent for exact roles like these with zero upfront retainer.\n\nOpen to a brief 10-minute chat this week to see if we can take some open reqs off your plate?\n\nBest,\n${myName}`;
    return { subject, body };
  });
  const elapsedMs = performance.now() - start;

  console.log(`[PERF TIMING] Generated ${count} grounded batch outreach drafts in ${elapsedMs.toFixed(3)}ms (${(elapsedMs / count).toFixed(4)}ms/draft)`);

  const csvStart = performance.now();
  const headers = ['First Name', 'Last Name', 'Full Name', 'Company', 'Title', 'Email', 'LinkedIn', 'Subject', 'Message Body', 'Role Title', 'Role Link'];
  const escapeCsv = (str) => {
    const val = String(str || '');
    if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };
  const csvContent = [
    headers.map(escapeCsv).join(','),
    ...dummyItems.map((item, idx) => [
      item.firstName,
      'Contact',
      item.name,
      item.company,
      item.title,
      item.email,
      item.linkedinUrl,
      drafts[idx].subject,
      drafts[idx].body,
      item.jobTitle,
      '',
    ].map(escapeCsv).join(',')),
  ].join('\r\n');
  const csvElapsedMs = performance.now() - csvStart;

  console.log(`[PERF TIMING] Formatted sequencer CSV for ${count} recipients (${csvContent.length} bytes) in ${csvElapsedMs.toFixed(3)}ms`);
}

benchmarkBatchEngine();
