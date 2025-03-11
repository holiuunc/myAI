import type { ProviderName } from "@/types";

export const INTENTION_MODEL: string = "gpt-4o-mini";
// export const INTENTION_TEMPERATURE: number = 0.7; Original
export const INTENTION_TEMPERATURE: number = 0.5; // More deterministic

export const RANDOM_RESPONSE_PROVIDER: ProviderName = "openai";
export const RANDOM_RESPONSE_MODEL: string = "gpt-4o-mini";
// export const RANDOM_RESPONSE_TEMPERATURE: number = 0.7; Original
export const RANDOM_RESPONSE_TEMPERATURE: number = 0.8; // More creative

export const HOSTILE_RESPONSE_PROVIDER: ProviderName = "openai";
export const HOSTILE_RESPONSE_MODEL: string = "gpt-4o-mini";
export const HOSTILE_RESPONSE_TEMPERATURE: number = 0.7;

export const QUESTION_RESPONSE_PROVIDER: ProviderName = "openai";
export const QUESTION_RESPONSE_MODEL: string = "gpt-4o";
export const QUESTION_RESPONSE_TEMPERATURE: number = 0.7;

// Educational AI Models
export const EXPLANATION_RESPONSE_PROVIDER: ProviderName = "openai";
export const EXPLANATION_RESPONSE_MODEL: string = "gpt-4o";
export const EXPLANATION_RESPONSE_TEMPERATURE: number = 0.6;

export const EXERCISE_RESPONSE_PROVIDER: ProviderName = "openai";
export const EXERCISE_RESPONSE_MODEL: string = "gpt-4o";
export const EXERCISE_RESPONSE_TEMPERATURE: number = 0.7;

export const ASSESSMENT_RESPONSE_PROVIDER: ProviderName = "openai";
export const ASSESSMENT_RESPONSE_MODEL: string = "gpt-4o";
export const ASSESSMENT_RESPONSE_TEMPERATURE: number = 0.5;

export const STUDY_PLAN_PROVIDER: ProviderName = "openai";
export const STUDY_PLAN_MODEL: string = "gpt-4o";
export const STUDY_PLAN_TEMPERATURE: number = 0.6;

export const DOCUMENT_SUMMARY_PROVIDER: ProviderName = "openai";
export const DOCUMENT_SUMMARY_MODEL: string = "gpt-4o";
export const DOCUMENT_SUMMARY_TEMPERATURE: number = 0.4;

export const HYDE_MODEL: string = "gpt-4o-mini";
// export const HYDE_TEMPERATURE: number = 0.7; Original
export const HYDE_TEMPERATURE: number = 0.9; // More creative
