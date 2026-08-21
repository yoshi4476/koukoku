/* eslint-disable no-console */
import { formatReport, runAllSuites } from './runner';

// CI/ローカルから `pnpm eval` で実行。未達スイートがあれば exit 1
const results = runAllSuites();
console.log(formatReport(results));
if (!results.every((r) => r.ok)) process.exit(1);
