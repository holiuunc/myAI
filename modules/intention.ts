import type { OpenAI } from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { Chat, Intention, IntentionType } from "@/types";
import { intentionSchema } from "@/types";
import { HISTORY_CONTEXT_LENGTH } from "@/configuration/chat";
import { INTENTION_PROMPT } from "@/configuration/prompts";
import { INTENTION_MODEL } from "@/configuration/models";

/**
 * IntentionModule is responsible for detecting intentions
 */
// biome-ignore lint/complexity/noStaticOnlyClass: <explanation>
export class IntentionModule {
  static async detectIntention({
    chat,
    openai,
  }: {
    chat: Chat;
    openai: OpenAI;
  }): Promise<Intention> {
    /**
     * Determine the intention of the user based on the most recent messages
     */
    const mostRecentMessages = chat.messages
      .slice(-HISTORY_CONTEXT_LENGTH)
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      .map((msg: any) => ({
        role: msg.role,
        content: msg.content,
      }));

    // Check for educational patterns before calling the model
    const lastUserMessage = mostRecentMessages
      .filter((msg: { role: string; }) => msg.role === "user")
      .pop()?.content?.toLowerCase() || "";

    // Pattern matching for educational queries
    const explanationPatterns = [
      /explain (to me |me |)?(what|how|why|when|where|who|the)/i,
      /help me understand/i,
      /can you (explain|describe|clarify)/i,
      /what (is|are|does|do) .*(mean|definition|purpose)/i,
      /how (do|does|can|would) .*(work|function)/i,
      /tell me (about|more about)/i,
      /what's the (concept|idea|theory|principle) (of|behind)/i,
      /teach me (about|how to)/i
    ];
    
    // EXERCISE REQUEST PATTERNS
    const exercisePatterns = [
      /give me (an |some |)(exercise|exercises|practice|problem|problems|question|questions)/i,
      /can (I|you) practice/i,
      /let('s| us) practice/i,
      /create (a|an|some) (quiz|test|exercise|problem)/i,
      /how (can|do) I practice/i,
      /I want to practice/i,
      /I need (more |some |)practice/i,
      /generate (a|an|some) (exercise|problem)/i
    ];
    
    // KNOWLEDGE ASSESSMENT PATTERNS
    const assessmentPatterns = [
      /test (my|me on|me about) (knowledge|understanding)/i,
      /assess (my|me)/i,
      /evaluate (my|me)/i,
      /quiz me/i,
      /check (my|what I) (know|learned|understand)/i,
      /how (well|much) do I (know|understand)/i,
      /give me a (test|quiz|assessment)/i,
      /am I ready for/i
    ];

    // STUDY PLAN REQUEST PATTERNS
    const studyPlanPatterns = [
      /create (a|an) (study|learning) plan/i,
      /help me (study|plan|prepare)/i,
      /how should I (study|prepare|learn)/i,
      /what('s| is) the best way to (study|learn|prepare)/i,
      /make (a|me a) (schedule|plan|roadmap)/i,
      /design (a|an) (curriculum|course|study path)/i,
      /how (do|can|should) I organize my (studies|learning)/i,
      /what order should I (learn|study)/i
    ];
    
    // DOCUMENT SUMMARY REQUEST PATTERNS
    const documentSummaryPatterns = [
      /summarize (this|the|these|those) (document|text|article|paper|reading)/i,
      /give me (a|the) (summary|overview|brief|synopsis)/i,
      /can you (summarize|condense|digest)/i,
      /what (is|are) the (key|main) (point|points|idea|ideas|concept|concepts)/i,
      /tldr/i,
      /in (a nutshell|brief|summary)/i,
      /what does (this|the) (document|article|paper|reading) (say|talk about)/i,
      /extract (important|key|main) (information|points|ideas)/i
    ];
    
    // HOSTILE MESSAGE PATTERNS
    const hostilePatterns = [
      /you('re| are) (stupid|dumb|useless|worthless)/i,
      /(fuck|shit|damn|hell)/i,
      /I hate you/i,
      /you suck/i,
      /this is (ridiculous|absurd)/i,
      /you don't know (anything|what you're talking about)/i,
      /waste of (time|money)/i,
      /(terrible|awful|horrible) (assistant|ai|bot)/i
    ];

    // QUESTION PATTERNS (general questions not covered by other categories)
    const questionPatterns = [
      /^(who|what|when|where|why|how|is|are|can|do|does|will|would|should|could|did|has|have)/i,
      /\?$/i,
      /^(tell|show) me/i,
      /^I (want|need) to know/i
    ];

    // Check patterns and return the appropriate intention
    if (hostilePatterns.some(pattern => pattern.test(lastUserMessage))) {
      return { type: "hostile_message" as IntentionType };
    }
    
    if (explanationPatterns.some(pattern => pattern.test(lastUserMessage))) {
      return { type: "explanation_request" as IntentionType };
    }
    
    if (exercisePatterns.some(pattern => pattern.test(lastUserMessage))) {
      return { type: "exercise_request" as IntentionType };
    }
    
    if (assessmentPatterns.some(pattern => pattern.test(lastUserMessage))) {
      return { type: "knowledge_assessment" as IntentionType };
    }
    
    if (studyPlanPatterns.some(pattern => pattern.test(lastUserMessage))) {
      return { type: "study_plan_request" as IntentionType };
    }
    
    if (documentSummaryPatterns.some(pattern => pattern.test(lastUserMessage))) {
      return { type: "document_summary_request" as IntentionType };
    }
    
    if (questionPatterns.some(pattern => pattern.test(lastUserMessage))) {
      return { type: "question" as IntentionType };
    }

    // If not detected through patterns, use the model
    const response = await openai.beta.chat.completions.parse({
      model: INTENTION_MODEL,
      messages: [
        { role: "system", content: INTENTION_PROMPT() },
        ...mostRecentMessages,
      ],
      response_format: zodResponseFormat(intentionSchema, "intention"),
    });

    if (!response.choices[0].message.parsed) {
      return { type: "random" as IntentionType };
    }
    return response.choices[0].message.parsed;
  }
}
