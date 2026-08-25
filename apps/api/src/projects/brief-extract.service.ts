import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import type { BriefExtractDto, ProjectBrief } from '@adgrid/shared';
import { AppError } from '../common/errors';
import { LlmService } from '../ai/llm.service';
import { OUTPUT_SCHEMAS, PROMPTS } from '../ai/prompt-registry';

const MAX_BYTES = 1_500_000; // 取得サイズ上限
const MAX_TEXT_CHARS = 12_000; // LLMに渡す本文の上限
const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

const BRIEF_KEYS: (keyof ProjectBrief)[] = [
  'business', 'product', 'usp', 'targetPersona', 'painPoint', 'offer',
  'reasonToChoose', 'area', 'ngItems', 'note',
];

/** ループバック・プライベート・リンクローカル等、内部ネットワークのIPか */
function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local (クラウドのメタデータ含む)
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    if (s.startsWith('fc') || s.startsWith('fd')) return true; // unique local
    if (s.startsWith('fe80')) return true; // link-local
    if (s.startsWith('::ffff:')) return isPrivateAddress(s.slice(7)); // IPv4射影
    return false;
  }
  return true; // 判定不能は拒否側
}

/**
 * サイトURLからヒアリングを自動抽出する (F-52)。
 * ヒアリングが空だと広告文が一般論になるため、入力の手間を外して記入率を上げる。
 * 外部URLをサーバから取得するため、SSRF (内部ネットワークへの到達) を厳格に遮断する。
 */
@Injectable()
export class BriefExtractService {
  private readonly logger = new Logger(BriefExtractService.name);

  constructor(private readonly llm: LlmService) {}

  /** URLを検証し、内部ネットワーク宛でないことを確認する */
  private async assertPublicUrl(raw: string): Promise<URL> {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new AppError(HttpStatus.BAD_REQUEST, 'URLの形式が正しくありません。', 'https:// から始まるURLを入力してください。');
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new AppError(HttpStatus.BAD_REQUEST, '対応していないURLです。', 'http または https のURLを入力してください。');
    }
    const host = u.hostname.replace(/^\[|\]$/g, '');
    // ホスト名がIPならそのまま、ドメインならDNS解決して判定
    const addrs: string[] = isIP(host)
      ? [host]
      : await lookup(host, { all: true }).then((r) => r.map((a) => a.address)).catch(() => []);
    if (addrs.length === 0) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'サイトに接続できませんでした。', 'URLが正しいか、サイトが公開されているか確認してください。');
    }
    if (addrs.some(isPrivateAddress)) {
      throw new AppError(HttpStatus.BAD_REQUEST, '内部ネットワークのURLは指定できません。', '公開されているサイトのURLを入力してください。');
    }
    return u;
  }

  /** リダイレクトを手動で追い、各ホップで内部宛でないことを検証しながら取得する */
  private async fetchPublicPage(raw: string): Promise<{ finalUrl: string; html: string }> {
    let current = raw;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const u = await this.assertPublicUrl(current);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(u.toString(), {
          redirect: 'manual',
          signal: ctrl.signal,
          headers: { 'user-agent': 'ADGRID-BriefExtractor/1.0', accept: 'text/html,application/xhtml+xml' },
        });
      } catch {
        throw new AppError(HttpStatus.BAD_GATEWAY, 'サイトを取得できませんでした。', 'URLが正しいか、サイトが公開されているか確認してください。');
      } finally {
        clearTimeout(timer);
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) break;
        current = new URL(loc, u).toString();
        continue;
      }
      if (!res.ok) {
        throw new AppError(HttpStatus.BAD_GATEWAY, `サイトの取得に失敗しました (${res.status})。`, 'URLが正しいか確認してください。');
      }
      const type = res.headers.get('content-type') ?? '';
      if (!type.includes('html') && !type.includes('text')) {
        throw new AppError(HttpStatus.BAD_REQUEST, 'HTMLページではありません。', 'サイトのトップページやサービス紹介ページのURLを指定してください。');
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) {
        throw new AppError(HttpStatus.BAD_REQUEST, 'ページが大きすぎます。', '別のページのURLでお試しください。');
      }
      return { finalUrl: u.toString(), html: new TextDecoder('utf-8').decode(buf) };
    }
    throw new AppError(HttpStatus.BAD_GATEWAY, 'リダイレクトが多すぎます。', '最終的なURLを直接指定してください。');
  }

  /** HTMLから本文テキストを抽出する (スクリプト・スタイル・タグを除去) */
  private toText(html: string): string {
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/[ \t　]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim();
    return text.slice(0, MAX_TEXT_CHARS);
  }

  async fromUrl(tenantId: string, url: string): Promise<BriefExtractDto> {
    if (!this.llm.available) {
      throw new AppError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ANTHROPIC_API_KEY が未設定のため自動入力は使えません。',
        '.env に ANTHROPIC_API_KEY を設定するか、ヒアリングを手入力してください。',
      );
    }
    const { finalUrl, html } = await this.fetchPublicPage(url.trim());
    const text = this.toText(html);
    if (text.length < 200) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'ページから十分な本文を読み取れませんでした。',
        '文章の多いページ（会社概要・サービス紹介など）のURLでお試しください。',
      );
    }

    const user = [
      `以下のスキーマのJSONのみを出力してください:\n${OUTPUT_SCHEMAS.briefExtract}`,
      `<page url="${finalUrl}">\n${text}\n</page>`,
    ].join('\n\n');

    const raw = await this.llm.completeText({
      tenantId,
      feature: 'brief_extract',
      model: PROMPTS.briefExtract.model,
      system: PROMPTS.briefExtract.system,
      user,
      maxTokens: 2000,
      promptVersion: PROMPTS.briefExtract.version,
    });

    const parsed = LlmService.parseJson(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') {
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, '抽出結果を解釈できませんでした。', 'もう一度お試しください。');
    }

    const brief: Partial<ProjectBrief> = {};
    const filledKeys: (keyof ProjectBrief)[] = [];
    for (const k of BRIEF_KEYS) {
      const v = parsed[k];
      const s = typeof v === 'string' ? v.trim() : '';
      if (s) {
        brief[k] = s.slice(0, 800);
        filledKeys.push(k);
      }
    }
    // 参考URLには取得元を入れておく (担当者が後から辿れるように)
    brief.reference = finalUrl;

    const caution = typeof parsed.caution === 'string' ? parsed.caution.trim().slice(0, 400) : '';
    this.logger.log(`brief extracted from ${finalUrl}: ${filledKeys.length} fields`);
    return { sourceUrl: finalUrl, brief, filledKeys, caution };
  }
}
