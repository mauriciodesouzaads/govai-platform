import { useId } from 'react';
import type { Tone } from '../lib/vocab.js';

// An accessible ratio indicator: an inline SVG ring, no chart library, no trend line, no
// invented risk score. It renders exactly one number the API already computed.
//
// The ring is decorative (aria-hidden); the number and its covered/total breakdown are the
// accessible content, and a `role="img"` wrapper carries the same fact as a label so a screen
// reader gets the ratio without having to interpret geometry.

const TONE_STROKE: Record<Tone, string> = {
  ok: 'var(--govai-ok-text)',
  attention: 'var(--govai-attention-text)',
  failure: 'var(--govai-failure-text)',
  neutral: 'var(--govai-border-strong)',
  info: 'var(--govai-info-text)',
};

export function CoverageRing({
  ratio,
  tone,
  label,
  display,
  size = 128,
}: {
  /** 0..1 as the API reports it. */
  ratio: number;
  tone: Tone;
  /** Accessible description of what the ring shows, already localized. */
  label: string;
  /** The formatted ratio, rendered inside the ring. */
  display: string;
  size?: number;
}) {
  const titleId = useId();
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(Math.max(ratio, 0), 1);
  const dash = circumference * clamped;

  return (
    <div className="flex items-center gap-[var(--govai-space-4)]">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-labelledby={titleId}
        className="shrink-0"
      >
        <title id={titleId}>{label}</title>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--govai-bg-inset)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={TONE_STROKE[tone]}
          strokeWidth={stroke}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="butt"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          className="govai-tabular"
          fontSize={size * 0.22}
          fontWeight={600}
          fill="var(--govai-text-primary)"
        >
          {display}
        </text>
      </svg>
    </div>
  );
}
