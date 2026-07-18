import { assessProductionReadiness } from '../src/production-readiness.js';

const result = assessProductionReadiness(process.env);
console.log(`Commercial production configuration: ${result.ready ? 'READY' : 'NOT READY'}`);
for (const message of result.errors) console.error(`ERROR: ${message}`);
for (const message of result.warnings) console.warn(`WARN: ${message}`);
process.exitCode = result.ready ? 0 : 1;
