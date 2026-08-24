import { performance } from 'node:perf_hooks';

const mockAccounts = [
  { id: 'acc_1', displayName: 'Stripe', jobCount: 4, openRoleCount: 4, industry: 'Fintech' },
  { id: 'acc_2', displayName: 'Datadog', jobCount: 6, openRoleCount: 6, industry: 'Observability' },
];
const mockJobs = [
  { id: 'job_1', title: 'Staff Distributed Systems Engineer', companyName: 'Stripe', department: 'Infrastructure', accountId: 'acc_1', connectionCount: 2 },
  { id: 'job_2', title: 'Senior Backend Engineer', companyName: 'Datadog', department: 'Platform', accountId: 'acc_2', connectionCount: 1 },
];

function benchmark(name, fn, iterations = 1000) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const total = performance.now() - start;
  const avgUs = (total / iterations) * 1000;
  console.log(`[BENCHMARK] ${name}: ${avgUs.toFixed(3)} μs/op (${iterations} runs in ${total.toFixed(2)}ms)`);
}

benchmark('persona-state-read', () => {
  const persona = 'jobseeker';
  const isJobSeeker = persona === 'jobseeker';
}, 10000);
