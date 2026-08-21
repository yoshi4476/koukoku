'use client';

import Link from 'next/link';
import type { HomeDto, HomeTaskDto, OnboardingStatusDto, TaskKind } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { ErrorCard, PlatformTag, Skeleton } from '@/components/ui';
import { formatDate } from '@/lib/format';

const GROUPS: Array<{ kind: TaskKind; title: string }> = [
  { kind: 'alert', title: 'アラート' },
  { kind: 'ai_proposal', title: 'AI提案 (未読)' },
  { kind: 'approval', title: '承認待ち' },
  { kind: 'report', title: '今日のレポート予定' },
];

const ACTION_LABEL: Record<TaskKind, string> = {
  alert: '確認する',
  ai_proposal: '提案を見る',
  approval: '承認へ',
  report: '開く',
};

function TaskRow({ task }: { task: HomeTaskDto }) {
  const primary = task.kind === 'ai_proposal' || task.kind === 'report';
  return (
    <div className={`task sev-${task.severity}`}>
      <div className="t-body">
        <div className="t-title">{task.title}</div>
        <div className="t-sub">{task.subtitle}</div>
      </div>
      <div className="t-meta">
        <span className="tag">{task.clientName}</span>
        {task.platform ? <PlatformTag platform={task.platform} /> : null}
        <Link href={task.href} className={`btn sm ${primary ? 'pri' : 'sec'}`}>
          {ACTION_LABEL[task.kind]}
        </Link>
      </div>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="queue" aria-label="読み込み中">
      {Array.from({ length: 4 }, (_, i) => (
        <div className="task" key={i}>
          <div className="t-body">
            <Skeleton w="60%" h={14} style={{ marginBottom: 8 }} />
            <Skeleton w="40%" h={11} />
          </div>
          <Skeleton w={120} h={26} />
        </div>
      ))}
    </div>
  );
}

export default function HomePage() {
  const { data, loading, error, retry } = useApi<HomeDto>('/home');
  const onboarding = useApi<OnboardingStatusDto>('/onboarding/status');
  const needsSetup = onboarding.data?.needsOnboarding === true;

  return (
    <>
      <div className="page-h">
        <h1>{data ? `${formatDate(data.date)} の司令室` : '今日の司令室'}</h1>
        {data ? (
          <span className="sub">
            対応済み <b className="num">{data.doneCount}</b>/<b className="num">{data.totalCount}</b> 件
          </span>
        ) : null}
      </div>

      {error ? <ErrorCard error={error} onRetry={retry} /> : null}
      {loading ? <HomeSkeleton /> : null}

      {data && data.tasks.length === 0 ? (
        needsSetup ? (
          <div className="empty">
            <div className="e-title">初期セットアップを完了させましょう</div>
            <div className="e-sub">クライアント登録とデータ接続が済むと、ここに毎日のタスクが並びます。</div>
            <Link href="/onboarding" className="btn pri">セットアップを続ける</Link>
          </div>
        ) : (
          <div className="empty">
            <div className="e-title">今日は対応事項がありません</div>
            <div className="e-sub">アラート・AI提案・レポート予定はすべて対応済みです。</div>
            <Link href="/dashboard" className="btn pri">ダッシュボードを見る</Link>
          </div>
        )
      ) : null}

      {data
        ? GROUPS.map(({ kind, title }) => {
            const tasks = data.tasks.filter((t) => t.kind === kind);
            if (tasks.length === 0) return null;
            return (
              <section key={kind}>
                <div className="q-head">
                  <h2>{title}</h2>
                  <span className="cnt">{tasks.length}</span>
                </div>
                <div className="queue" style={{ marginBottom: 4 }}>
                  {tasks.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </div>
              </section>
            );
          })
        : null}
    </>
  );
}
