export interface SongPart {
  text: string;
  label?: string;
  style?: string;
}

export interface Block {
  type: string;
  [key: string]: unknown;
}

export interface QrItem {
  path?: string;
  caption?: string;
  size_mm?: number;
}

export interface SpecPage {
  columns: Block[][];
  column_weights?: number[];
}

export interface Spec {
  metadata?: Record<string, string>;
  layout?: {
    margin_mm?: number;
    horizontal_margin_mm?: number;
    vertical_margin_mm?: number;
    gutter_mm?: number;
  };
  output?: string;
  folded?: boolean;
  cover?: Block[];
  flow?: Block[];
  pages?: SpecPage[];
}

export interface FoldedFlowPlan {
  scale: number;
  columns: [Block[], Block[], Block[]];
}
