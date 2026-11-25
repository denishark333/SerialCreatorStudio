import type { ReactNode } from 'react';
import { CircleCheck, CirclePlay, Clapperboard, CodeXml, type LucideProps } from 'lucide-react';
import type { ApiPlan, ApiPlanStage, Platform } from '../api';
import { PlatformDeck } from '../PlatformDeck';
import { dateToday } from '../studioApi';
import { planPlatforms, scheduleLabel, stageLabel } from './calendar';
import { Topography } from './Topography';

/** Comic-style thought bubble (lucide has none): an idea. */
function ThoughtBubble(props: LucideProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...iconSize(props)}
    >
      <path d="M6.5 13.5a3 3 0 0 1-.4-6 3.6 3.6 0 0 1 6.3-2.6 3.6 3.6 0 0 1 6.1 1.6 3 3 0 0 1 .3 6 3.6 3.6 0 0 1-6 1.6 3.6 3.6 0 0 1-6.3-.6z" />
      <circle cx="6" cy="17.6" r="1.6" />
      <circle cx="3.4" cy="21" r="1" />
    </svg>
  );
}
/** Cinema camera with two film reels (lucide has none): recording. */
function CinemaCamera(props: LucideProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...iconSize(props)}
    >
      <circle cx="6.5" cy="6" r="3" />
      <circle cx="13.5" cy="6" r="3" />
      <rect x="2.5" y="10" width="13.5" height="9" rx="2" />
      <path d="m16 13.2 5.5-2.7v8l-5.5-2.7" />
    </svg>
  );
}
const iconSize = ({ size = 24, className }: LucideProps) => ({ width: size, height: size, className });

const STAGE_ICONS: Record<ApiPlanStage, (props: LucideProps) => ReactNode> = {
  Ideia: ThoughtBubble,
  Roteiro: CodeXml,
  Gravação: CinemaCamera,
  Edição: Clapperboard,
  Pronto: CirclePlay,
  Publicado: CircleCheck,
};
/** The icon of a production stage: idea bubble, </>, cinema camera, clapperboard, play (ready), check (published). */
export function StageIcon({ stage, size = 24 }: { stage: ApiPlanStage; size?: number }) {
  const Icon = STAGE_ICONS[stage] ?? ThoughtBubble;
  return <Icon size={size} className={'stage-icon stage-icon-' + stageKey(stage)} aria-hidden="true" />;
}
const stageKey = (stage: ApiPlanStage) =>
  stage
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const PLATFORM_COLORS: Record<Platform, string> = { YouTube: '#ff4561', Twitch: '#ad83ff', Kick: '#53fc18' };

/**
 * Cover of a plan: the real thumbnail once its video is linked; before that, animated topographic lines in the
 * colour of the main platform, the current stage's icon in the middle, the platforms in the top-right corner and
 * the date/title at the bottom.
 */
export function PlanCover({
  plan,
  compact = false,
  caption = !compact,
}: {
  plan: ApiPlan;
  compact?: boolean;
  /** Date and title over the bottom of the cover. */
  caption?: boolean;
}) {
  const platforms = planPlatforms(plan);
  return (
    <div className={'plan-cover' + (compact ? ' compact' : '')} data-stage={stageKey(plan.stage)}>
      {plan.content?.thumbnailUrl ? (
        <img src={plan.content.thumbnailUrl} alt="" />
      ) : (
        <>
          <Topography color={PLATFORM_COLORS[platforms[0]] ?? '#b4f500'} levels={compact ? 9 : 12} />
          <span className="plan-cover-stage" title={stageLabel(plan.stage, plan.format)}>
            <StageIcon stage={plan.stage} size={compact ? 22 : 30} />
          </span>
        </>
      )}
      <span className="plan-cover-platforms">
        <PlatformDeck platforms={platforms} size={compact ? 15 : 18} />
      </span>
      {caption && (
        <span className="plan-cover-caption">
          <small>{scheduleLabel(plan.date, plan.time, dateToday())}</small>
          <strong>{plan.title}</strong>
        </span>
      )}
    </div>
  );
}
