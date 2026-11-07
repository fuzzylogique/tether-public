/** Chart specs: plain data in, SVG string out (see ./index.ts). Times are epoch milliseconds. */

export type DonutSpec = {
  type: "donut";
  title?: string;
  segments: { label: string; value: number; color?: string }[];
  center?: { value: string; label?: string };
  legend?: boolean;
};

export type BarsSpec = {
  type: "bars";
  title?: string;
  /** Horizontal progress bars; colour defaults to the budget threshold colour of value/max. */
  rows: { label: string; value: number; max: number; valueLabel?: string; color?: string }[];
};

export type FunnelSpec = {
  type: "funnel";
  title?: string;
  stages: { label: string; count: number; detail?: string; color?: string }[];
  aside?: { label: string; count: number; detail?: string };
};

export type TimelineSpec = {
  type: "timeline";
  title?: string;
  from: number;
  to: number;
  now?: number;
  /** IANA zone used for hour labels. */
  timeZone?: string;
  events: { label: string; start: number; end: number; color?: string }[];
};

export type StepGraphSpec = {
  type: "stepGraph";
  title?: string;
  nodes: {
    id: string; label: string; detail?: string; color: string; level: number;
    status?: "pending" | "running" | "done" | "failed" | "skipped";
    locked?: boolean; disabled?: boolean;
  }[];
  edges: [from: string, to: string][];
};

export type StackedSpec = {
  type: "stacked";
  title?: string;
  segments: { label: string; value: number; color: string }[];
};

export type SparklineSpec = {
  type: "sparkline";
  title?: string;
  points: number[];
  color?: string;
  caption?: string;
};

/** Square glyph tile, used for app emoji and avatars. */
export type BadgeSpec = {
  type: "badge";
  size: number;
  bg: string;
  glyph: "finance" | "outreach" | "socials" | "calendar" | "coordination" | "helpdesk"
    | "running" | "done" | "failed" | "locked" | "pending" | "tether";
  shape?: "circle" | "rounded";
};

export type ChartSpec = DonutSpec | BarsSpec | FunnelSpec | TimelineSpec | StepGraphSpec | StackedSpec | SparklineSpec | BadgeSpec;
