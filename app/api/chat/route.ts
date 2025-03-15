import { OpenAI } from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import type { AIProviders, Chat, Intention } from "@/types";
import { IntentionModule } from "@/modules/intention";
import { ResponseModule } from "@/modules/response";
import { PINECONE_INDEX_NAME } from "@/configuration/pinecone";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const maxDuration = 60;

// Get API keys
const pineconeApiKey = process.env.PINECONE_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const fireworksApiKey = process.env.FIREWORKS_API_KEY;

// Check if API keys are set
if (!pineconeApiKey) {
  throw new Error("PINECONE_API_KEY is not set");
}
if (!openaiApiKey) {
  throw new Error("OPENAI_API_KEY is not set");
}

// Initialize Pinecone
const pineconeClient = new Pinecone({
  apiKey: pineconeApiKey,
});
const pineconeIndex = pineconeClient.Index(PINECONE_INDEX_NAME);

// Initialize Providers
const openaiClient = new OpenAI({
  apiKey: openaiApiKey,
});
const anthropicClient = new Anthropic({
  apiKey: anthropicApiKey,
});
const fireworksClient = new OpenAI({
  baseURL: "https://api.fireworks.ai/inference/v1",
  apiKey: fireworksApiKey,
});
const providers: AIProviders = {
  openai: openaiClient,
  anthropic: anthropicClient,
  fireworks: fireworksClient,
};

async function determineIntention(chat: Chat): Promise<Intention> {
  return await IntentionModule.detectIntention({
    chat: chat,
    openai: providers.openai,
  });
}

export async function POST(req: Request) {
  const { chat } = await req.json();

  const intention: Intention = await determineIntention(chat);

  // Extract userId from the request (assuming you have authentication middleware)
  const userId = chat.userId; // Make sure this exists in your chat object
  
  if (!userId) {
    return NextResponse.json({ error: "User authentication required" }, { status: 401 });
  }
  
  // Create a namespaced index specific to this user
  const userPineconeIndex = pineconeIndex.namespace(userId);

  switch (intention.type) {
    case "hostile_message":
      return ResponseModule.respondToHostileMessage(chat, providers);
    case "random":
      return ResponseModule.respondToRandomMessage(chat, providers);
    case "question":
      return ResponseModule.respondToQuestion(chat, providers, userPineconeIndex);
    case "explanation_request":
      return ResponseModule.respondToExplanationRequest(chat, providers, userPineconeIndex);
    case "exercise_request":
      return ResponseModule.respondToExerciseRequest(chat, providers, userPineconeIndex);
    case "knowledge_assessment":
      return ResponseModule.respondToKnowledgeAssessment(chat, providers, userPineconeIndex);
    case "study_plan_request":
      return ResponseModule.respondToStudyPlanRequest(chat, providers, userPineconeIndex);
    case "document_summary_request":
      return ResponseModule.respondToDocumentSummaryRequest(chat, providers, userPineconeIndex);
    default:
      return ResponseModule.respondToRandomMessage(chat, providers);
  }
}
