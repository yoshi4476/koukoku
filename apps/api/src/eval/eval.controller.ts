import { Controller, Get } from '@nestjs/common';
import { runAllSuites, type SuiteResult } from './runner';

@Controller('eval')
export class EvalController {
  /** eval回帰の現在スコア (社内管理コンソール用。プロンプト品質の可視化) */
  @Get()
  run(): { suites: SuiteResult[]; allOk: boolean } {
    const suites = runAllSuites();
    return { suites, allOk: suites.every((s) => s.ok) };
  }
}
