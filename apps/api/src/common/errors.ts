import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

/** エラーは常に「原因 (message) + 解決策 (resolution)」のセットで返す (不安を作らない原則) */
export class AppError extends HttpException {
  constructor(status: HttpStatus, message: string, resolution: string) {
    super({ statusCode: status, message, resolution }, status);
  }
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const status = exception.getStatus();
      if (typeof body === 'object' && body !== null && 'resolution' in body) {
        res.status(status).json(body);
        return;
      }
      res.status(status).json({
        statusCode: status,
        message: typeof body === 'string' ? body : exception.message,
        resolution: '入力内容を確認して再試行してください。解決しない場合は管理者に連絡してください。',
      });
      return;
    }
    // eslint-disable-next-line no-console
    console.error(exception);
    res.status(500).json({
      statusCode: 500,
      message: 'サーバ内部でエラーが発生しました。',
      resolution: 'しばらく待って再試行してください。続く場合はAPIログを確認してください。',
    });
  }
}
