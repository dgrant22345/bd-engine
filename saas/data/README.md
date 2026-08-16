# State of ATS 2026 source snapshot

`state-of-ats-2026-companies.csv` is a pinned copy of the MIT-licensed
ResumeAI State of ATS 2026 dataset. It is used to reproduce BD Engine's public
ATS coverage benchmark.

- Upstream repository: https://github.com/Kayvan-Zahiri/state-of-ats-2026
- Upstream commit: `6f667a20d3e488d9a37a127ae5be90e77e35eec9`
- Upstream verification refresh: July 28, 2026
- Source SHA-256: `c6036836e93a9c946fd5ef67bf40d576c57411822ad43de02d8a4e2c4b279a3d`
- License: `state-of-ats-2026-LICENSE.txt`

The public analysis filters to rows whose `verified` value is `true`. The
source CSV contains 738 employers, including 704 verified rows and 34
unconfirmed rows. The upstream README contains stale contradictory prose in
two later paragraphs; calculations must use the pinned CSV rows and header,
not those paragraphs.
