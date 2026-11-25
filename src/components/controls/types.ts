export interface Choice {
  readonly label: string;
  readonly value: number | string;
}

export interface QuizOption {
  readonly label: string;
  readonly correct: boolean;
  readonly explanation?: string;
}
