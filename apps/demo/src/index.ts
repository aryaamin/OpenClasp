import { runDemo } from './scenario.js';

console.log('OpenClasp general-purpose assurance demo');
await runDemo((line) => console.log(`✓ ${line}`));
console.log('✓ Demo completed successfully');
