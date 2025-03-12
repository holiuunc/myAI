import type {
  Chat,
  Chunk,
  Source,
  CoreMessage,
  AIProviders,
  ProviderName,
  Citation,
} from "@/types";
import {
  convertToCoreMessages,
  embedHypotheticalData,
  generateHypotheticalData,
  getSourcesFromChunks,
  searchForChunksUsingEmbedding,
  getContextFromSources,
  getCitationsFromChunks,
  buildPromptFromContext,
  searchForChunksWithFilter,
} from "@/utilities/chat";
import {
  queueAssistantResponse,
  queueError,
  queueIndicator,
} from "@/actions/streaming";
import {
  HISTORY_CONTEXT_LENGTH,
  DEFAULT_RESPONSE_MESSAGE,
} from "@/configuration/chat";
import { stripMessagesOfCitations } from "@/utilities/chat";
import {
  RESPOND_TO_HOSTILE_MESSAGE_SYSTEM_PROMPT,
  RESPOND_TO_QUESTION_BACKUP_SYSTEM_PROMPT,
  RESPOND_TO_QUESTION_SYSTEM_PROMPT,
  RESPOND_TO_RANDOM_MESSAGE_SYSTEM_PROMPT,
  RESPOND_TO_EXPLANATION_SYSTEM_PROMPT,
  RESPOND_TO_EXPLANATION_BACKUP_SYSTEM_PROMPT,
  RESPOND_TO_EXERCISE_SYSTEM_PROMPT,
  RESPOND_TO_EXERCISE_BACKUP_SYSTEM_PROMPT,
  RESPOND_TO_ASSESSMENT_SYSTEM_PROMPT,
  RESPOND_TO_ASSESSMENT_BACKUP_SYSTEM_PROMPT,
  RESPOND_TO_STUDY_PLAN_SYSTEM_PROMPT,
  RESPOND_TO_STUDY_PLAN_BACKUP_SYSTEM_PROMPT,
  RESPOND_TO_DOCUMENT_SUMMARY_SYSTEM_PROMPT,
  RESPOND_TO_DOCUMENT_SUMMARY_BACKUP_SYSTEM_PROMPT,
} from "@/configuration/prompts";
import {
  RANDOM_RESPONSE_PROVIDER,
  RANDOM_RESPONSE_MODEL,
  HOSTILE_RESPONSE_PROVIDER,
  HOSTILE_RESPONSE_MODEL,
  QUESTION_RESPONSE_PROVIDER,
  QUESTION_RESPONSE_MODEL,
  HOSTILE_RESPONSE_TEMPERATURE,
  QUESTION_RESPONSE_TEMPERATURE,
  RANDOM_RESPONSE_TEMPERATURE,
  EXPLANATION_RESPONSE_PROVIDER,
  EXPLANATION_RESPONSE_MODEL,
  EXPLANATION_RESPONSE_TEMPERATURE,
  EXERCISE_RESPONSE_PROVIDER,
  EXERCISE_RESPONSE_MODEL,
  EXERCISE_RESPONSE_TEMPERATURE,
  ASSESSMENT_RESPONSE_PROVIDER,
  ASSESSMENT_RESPONSE_MODEL,
  ASSESSMENT_RESPONSE_TEMPERATURE,
  STUDY_PLAN_PROVIDER,
  STUDY_PLAN_MODEL,
  STUDY_PLAN_TEMPERATURE,
  DOCUMENT_SUMMARY_PROVIDER,
  DOCUMENT_SUMMARY_MODEL,
  DOCUMENT_SUMMARY_TEMPERATURE,
} from "@/configuration/models";
import { getDocuments } from "@/utilities/documents";

/**
 * ResponseModule is responsible for collecting data and building a response
 */
// biome-ignore lint/complexity/noStaticOnlyClass: <explanation>
export class ResponseModule {
  
  static async respondToRandomMessage(
    chat: Chat,
    providers: AIProviders
  ): Promise<Response> {
    /**
     * Respond to the user when they send a RANDOM message
     */
    const PROVIDER_NAME: ProviderName = RANDOM_RESPONSE_PROVIDER;
    const MODEL_NAME: string = RANDOM_RESPONSE_MODEL;

    const stream = new ReadableStream({
      async start(controller) {
        queueIndicator({
          controller,
          status: "Coming up with an answer",
          icon: "thinking",
        });
        const systemPrompt = RESPOND_TO_RANDOM_MESSAGE_SYSTEM_PROMPT();
        const mostRecentMessages: CoreMessage[] = await convertToCoreMessages(
          stripMessagesOfCitations(chat.messages.slice(-HISTORY_CONTEXT_LENGTH))
        );

        const citations: Citation[] = [];
        queueAssistantResponse({
          controller,
          providers,
          providerName: PROVIDER_NAME,
          messages: mostRecentMessages,
          model_name: MODEL_NAME,
          systemPrompt,
          citations,
          error_message: DEFAULT_RESPONSE_MESSAGE,
          temperature: RANDOM_RESPONSE_TEMPERATURE,
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  static async respondToHostileMessage(
    chat: Chat,
    providers: AIProviders
  ): Promise<Response> {
    /**
     * Respond to the user when they send a HOSTILE message
     */
    const PROVIDER_NAME: ProviderName = HOSTILE_RESPONSE_PROVIDER;
    const MODEL_NAME: string = HOSTILE_RESPONSE_MODEL;

    const stream = new ReadableStream({
      async start(controller) {
        queueIndicator({
          controller,
          status: "Coming up with an answer",
          icon: "thinking",
        });
        const systemPrompt = RESPOND_TO_HOSTILE_MESSAGE_SYSTEM_PROMPT();
        const citations: Citation[] = [];
        queueAssistantResponse({
          controller,
          providers,
          providerName: PROVIDER_NAME,
          messages: [],
          model_name: MODEL_NAME,
          systemPrompt,
          citations,
          error_message: DEFAULT_RESPONSE_MESSAGE,
          temperature: HOSTILE_RESPONSE_TEMPERATURE,
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  static async respondToQuestion(
    chat: Chat,
    providers: AIProviders,
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    index: any
  ): Promise<Response> {
    /**
     * Respond to the user when they send a QUESTION
     */
    const PROVIDER_NAME: ProviderName = QUESTION_RESPONSE_PROVIDER;
    const MODEL_NAME: string = QUESTION_RESPONSE_MODEL;

    const stream = new ReadableStream({
      async start(controller) {
        queueIndicator({
          controller,
          status: "Figuring out what your answer looks like",
          icon: "thinking",
        });
        try {
          const hypotheticalData: string = await generateHypotheticalData(
            chat,
            providers.openai
          );
          const { embedding }: { embedding: number[] } =
            await embedHypotheticalData(hypotheticalData, providers.openai);
          
            const lastUserMessage = chat.messages
            .filter(msg => msg.role === "user")
            .pop()?.content || "";
  
          // Check if a specific document was referenced
          const referencedDocId = await ResponseModule.findReferencedDocument(lastUserMessage);
  
          // Use different search strategies based on document reference
          let chunks: Chunk[];
          if (referencedDocId) {
            queueIndicator({
              controller,
              status: "Looking specifically in the referenced document",
              icon: "searching",
            });
            
            chunks = await searchForChunksWithFilter(
              embedding, 
              index,
              { source_url: { $eq: referencedDocId } }
            );
            
            // If no relevant chunks found, fall back to regular search
            if (chunks.length === 0) {
              queueIndicator({
                controller,
                status: "Expanding search to all documents",
                icon: "searching",
              });
              chunks = await searchForChunksUsingEmbedding(embedding, index);
            }
          } else {
            queueIndicator({
              controller,
              status: "Reading through documents",
              icon: "searching",
            });
            chunks = await searchForChunksUsingEmbedding(embedding, index);
          }

          const sources: Source[] = await getSourcesFromChunks(chunks);
          queueIndicator({
            controller,
            status: `Read over ${sources.length} documents`,
            icon: "documents",
          });
          const citations: Citation[] = await getCitationsFromChunks(chunks);
          const contextFromSources = await getContextFromSources(sources);
          const systemPrompt =
            RESPOND_TO_QUESTION_SYSTEM_PROMPT(contextFromSources);
          queueIndicator({
            controller,
            status: "Coming up with an answer",
            icon: "thinking",
          });
          queueAssistantResponse({
            controller,
            providers,
            providerName: PROVIDER_NAME,
            messages: stripMessagesOfCitations(
              chat.messages.slice(-HISTORY_CONTEXT_LENGTH)
            ),
            model_name: MODEL_NAME,
            systemPrompt,
            citations,
            error_message: DEFAULT_RESPONSE_MESSAGE,
            temperature: QUESTION_RESPONSE_TEMPERATURE,
          });
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        } catch (error: any) {
          console.error("Error in respondToQuestion:", error);
          queueError({
            controller,
            error_message: error.message ?? DEFAULT_RESPONSE_MESSAGE,
          });
          queueAssistantResponse({
            controller,
            providers,
            providerName: PROVIDER_NAME,
            messages: [],
            model_name: MODEL_NAME,
            systemPrompt: RESPOND_TO_QUESTION_BACKUP_SYSTEM_PROMPT(),
            citations: [],
            error_message: DEFAULT_RESPONSE_MESSAGE,
            temperature: QUESTION_RESPONSE_TEMPERATURE,
          });
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  static async respondToExplanationRequest(
    chat: Chat,
    providers: AIProviders,
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    index: any
  ): Promise<Response> {
    /**
     * Respond to the user when they request an explanation for a concept
     */
    const PROVIDER_NAME: ProviderName = EXPLANATION_RESPONSE_PROVIDER;
    const MODEL_NAME: string = EXPLANATION_RESPONSE_MODEL;
  
    const stream = new ReadableStream({
      async start(controller) {
        queueIndicator({
          controller,
          status: "Understanding your concept question",
          icon: "understanding",
        });
        try {
          const hypotheticalData: string = await generateHypotheticalData(
            chat,
            providers.openai
          );
          const { embedding }: { embedding: number[] } =
            await embedHypotheticalData(hypotheticalData, providers.openai);
          
          const lastUserMessage = chat.messages
            .filter(msg => msg.role === "user")
            .pop()?.content || "";
  
          // Check if a specific document was referenced
          const referencedDocId = await ResponseModule.findReferencedDocument(lastUserMessage);
  
          // Use different search strategies based on document reference
          let chunks: Chunk[];
          if (referencedDocId) {
            queueIndicator({
              controller,
              status: "Looking specifically in the referenced document",
              icon: "searching",
            });
            
            chunks = await searchForChunksWithFilter(
              embedding, 
              index,
              { source_url: { $eq: referencedDocId } }
            );
            
            // If no relevant chunks found, fall back to regular search
            if (chunks.length === 0) {
              queueIndicator({
                controller,
                status: "Expanding search to all documents",
                icon: "searching",
              });
              chunks = await searchForChunksUsingEmbedding(embedding, index);
            }
          } else {
            queueIndicator({
              controller,
              status: "Reading through documents",
              icon: "searching",
            });
            chunks = await searchForChunksUsingEmbedding(embedding, index);
          }

          const sources: Source[] = await getSourcesFromChunks(chunks);
          queueIndicator({
            controller,
            status: `Found ${sources.length} resources about this topic`,
            icon: "documents",
          });
          const citations: Citation[] = await getCitationsFromChunks(chunks);
          const contextFromSources = await getContextFromSources(sources);
          const systemPrompt =
            RESPOND_TO_EXPLANATION_SYSTEM_PROMPT(contextFromSources);
          queueIndicator({
            controller,
            status: "Crafting a clear explanation",
            icon: "thinking",
          });
          queueAssistantResponse({
            controller,
            providers,
            providerName: PROVIDER_NAME,
            messages: stripMessagesOfCitations(
              chat.messages.slice(-HISTORY_CONTEXT_LENGTH)
            ),
            model_name: MODEL_NAME,
            systemPrompt,
            citations,
            error_message: DEFAULT_RESPONSE_MESSAGE,
            temperature: EXPLANATION_RESPONSE_TEMPERATURE,
          });
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        } catch (error: any) {
          console.error("Error in respondToExplanationRequest:", error);
          queueError({
            controller,
            error_message: error.message ?? DEFAULT_RESPONSE_MESSAGE,
          });
          queueAssistantResponse({
            controller,
            providers,
            providerName: PROVIDER_NAME,
            messages: [],
            model_name: MODEL_NAME,
            systemPrompt: RESPOND_TO_EXPLANATION_BACKUP_SYSTEM_PROMPT(),
            citations: [],
            error_message: DEFAULT_RESPONSE_MESSAGE,
            temperature: EXPLANATION_RESPONSE_TEMPERATURE,
          });
        }
      },
    });
  
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }
  
  static async respondToExerciseRequest(
    chat: Chat,
    providers: AIProviders,
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    index: any
  ): Promise<Response> {
    /**
     * Respond to the user when they request practice exercises
     */
    const PROVIDER_NAME: ProviderName = EXERCISE_RESPONSE_PROVIDER;
    const MODEL_NAME: string = EXERCISE_RESPONSE_MODEL;
  
    const stream = new ReadableStream({
      async start(controller) {
        queueIndicator({
          controller,
          status: "Identifying the exercise topic",
          icon: "understanding",
        });
        try {
          const hypotheticalData: string = await generateHypotheticalData(
            chat,
            providers.openai
          );
          const { embedding }: { embedding: number[] } =
            await embedHypotheticalData(hypotheticalData, providers.openai);
          
          const lastUserMessage = chat.messages
            .filter(msg => msg.role === "user")
            .pop()?.content || "";
  
          // Check if a specific document was referenced
          const referencedDocId = await ResponseModule.findReferencedDocument(lastUserMessage);
  
          // Use different search strategies based on document reference
          let chunks: Chunk[];
          if (referencedDocId) {
            queueIndicator({
              controller,
              status: "Looking specifically in the referenced document",
              icon: "searching",
            });
            
            chunks = await searchForChunksWithFilter(
              embedding, 
              index,
              { source_url: { $eq: referencedDocId } }
            );
            
            // If no relevant chunks found, fall back to regular search
            if (chunks.length === 0) {
              queueIndicator({
                controller,
                status: "Expanding search to all documents",
                icon: "searching",
              });
              chunks = await searchForChunksUsingEmbedding(embedding, index);
            }
          } else {
            queueIndicator({
              controller,
              status: "Reading through documents",
              icon: "searching",
            });
            chunks = await searchForChunksUsingEmbedding(embedding, index);
          }

          const sources: Source[] = await getSourcesFromChunks(chunks);
          queueIndicator({
            controller,
            status: `Found ${sources.length} related practice materials`,
            icon: "documents",
          });
          const citations: Citation[] = await getCitationsFromChunks(chunks);
          const contextFromSources = await getContextFromSources(sources);
          const systemPrompt =
            RESPOND_TO_EXERCISE_SYSTEM_PROMPT(contextFromSources);
          queueIndicator({
            controller,
            status: "Creating practice exercises for you",
            icon: "thinking",
          });
          queueAssistantResponse({
            controller,
            providers,
            providerName: PROVIDER_NAME,
            messages: stripMessagesOfCitations(
              chat.messages.slice(-HISTORY_CONTEXT_LENGTH)
            ),
            model_name: MODEL_NAME,
            systemPrompt,
            citations,
            error_message: DEFAULT_RESPONSE_MESSAGE,
            temperature: EXERCISE_RESPONSE_TEMPERATURE,
          });
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        } catch (error: any) {
          console.error("Error in respondToExerciseRequest:", error);
          queueError({
            controller,
            error_message: error.message ?? DEFAULT_RESPONSE_MESSAGE,
          });
          queueAssistantResponse({
            controller,
            providers,
            providerName: PROVIDER_NAME,
            messages: [],
            model_name: MODEL_NAME,
            systemPrompt: RESPOND_TO_EXERCISE_BACKUP_SYSTEM_PROMPT(),
            citations: [],
            error_message: DEFAULT_RESPONSE_MESSAGE,
            temperature: EXERCISE_RESPONSE_TEMPERATURE,
          });
        }
      },
    });
  
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }
  
  static async respondToKnowledgeAssessment(
    chat: Chat,
    providers: AIProviders,
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    index: any
  ): Promise<Response> {
    /**
     * Respond to the user when they request a knowledge assessment
     */
    const PROVIDER_NAME: ProviderName = ASSESSMENT_RESPONSE_PROVIDER;
    const MODEL_NAME: string = ASSESSMENT_RESPONSE_MODEL;
  
    const stream = new ReadableStream({
      async start(controller) {
        queueIndicator({
          controller,
          status: "Preparing your knowledge assessment",
          icon: "understanding",
        });
        try {
          const hypotheticalData: string = await generateHypotheticalData(
            chat,
            providers.openai
          );
          const { embedding }: { embedding: number[] } =
            await embedHypotheticalData(hypotheticalData, providers.openai);
          
          const lastUserMessage = chat.messages
            .filter(msg => msg.role === "user")
            .pop()?.content || "";
  
          // Check if a specific document was referenced
          const referencedDocId = await ResponseModule.findReferencedDocument(lastUserMessage);
  
          // Use different search strategies based on document reference
          let chunks: Chunk[];
          if (referencedDocId) {
            queueIndicator({
              controller,
              status: "Looking specifically in the referenced document",
              icon: "searching",
            });
            
            chunks = await searchForChunksWithFilter(
              embedding, 
              index,
              { source_url: { $eq: referencedDocId } }
            );
            
            // If no relevant chunks found, fall back to regular search
            if (chunks.length === 0) {
              queueIndicator({
                controller,
                status: "Expanding search to all documents",
                icon: "searching",
              });
              chunks = await searchForChunksUsingEmbedding(embedding, index);
            }
          } else {
            queueIndicator({
              controller,
              status: "Reading through documents",
              icon: "searching",
            });
            chunks = await searchForChunksUsingEmbedding(embedding, index);
          }

          const sources: Source[] = await getSourcesFromChunks(chunks);
          queueIndicator({
            controller,
            status: `Compiled ${sources.length} relevant assessment resources`,
            icon: "documents",
          });
          const citations: Citation[] = await getCitationsFromChunks(chunks);
          const contextFromSources = await getContextFromSources(sources);
          const systemPrompt =
            RESPOND_TO_ASSESSMENT_SYSTEM_PROMPT(contextFromSources);
          queueIndicator({
            controller,
            status: "Creating a personalized assessment",
            icon: "thinking",
          });
          queueAssistantResponse({
            controller,
            providers,
            providerName: PROVIDER_NAME,
            messages: stripMessagesOfCitations(
              chat.messages.slice(-HISTORY_CONTEXT_LENGTH)
            ),
            model_name: MODEL_NAME,
            systemPrompt,
            citations,
            error_message: DEFAULT_RESPONSE_MESSAGE,
            temperature: ASSESSMENT_RESPONSE_TEMPERATURE,
          });
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        } catch (error: any) {
          console.error("Error in respondToKnowledgeAssessment:", error);
          queueError({
            controller,
            error_message: error.message ?? DEFAULT_RESPONSE_MESSAGE,
          });
          queueAssistantResponse({
            controller,
            providers,
            providerName: PROVIDER_NAME,
            messages: [],
            model_name: MODEL_NAME,
            systemPrompt: RESPOND_TO_ASSESSMENT_BACKUP_SYSTEM_PROMPT(),
            citations: [],
            error_message: DEFAULT_RESPONSE_MESSAGE,
            temperature: ASSESSMENT_RESPONSE_TEMPERATURE,
          });
        }
      },
    });
  
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }
  
  static async respondToStudyPlanRequest(
    chat: Chat,
    providers: AIProviders,
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    index: any
  ): Promise<Response> {
    /**
     * Respond to the user when they request a study plan
     */
    const PROVIDER_NAME: ProviderName = STUDY_PLAN_PROVIDER;
    const MODEL_NAME: string = STUDY_PLAN_MODEL;
  
    const stream = new ReadableStream({
      async start(controller) {
        queueIndicator({
          controller,
          status: "Analyzing your study plan requirements",
          icon: "understanding",
        });
        try {
          const hypotheticalData: string = await generateHypotheticalData(
            chat,
            providers.openai
          );
          const { embedding }: { embedding: number[] } =
            await embedHypotheticalData(hypotheticalData, providers.openai);
          
          const lastUserMessage = chat.messages
            .filter(msg => msg.role === "user")
            .pop()?.content || "";
  
          // Check if a specific document was referenced
          const referencedDocId = await ResponseModule.findReferencedDocument(lastUserMessage);
  
          // Use different search strategies based on document reference
          let chunks: Chunk[];
          if (referencedDocId) {
            queueIndicator({
              controller,
              status: "Looking specifically in the referenced document",
              icon: "searching",
            });
            
            chunks = await searchForChunksWithFilter(
              embedding, 
              index,
              { source_url: { $eq: referencedDocId } }
            );
            
            // If no relevant chunks found, fall back to regular search
            if (chunks.length === 0) {
              queueIndicator({
                controller,
                status: "Expanding search to all documents",
                icon: "searching",
              });
              chunks = await searchForChunksUsingEmbedding(embedding, index);
            }
          } else {
            queueIndicator({
              controller,
              status: "Reading through documents",
              icon: "searching",
            });
            chunks = await searchForChunksUsingEmbedding(embedding, index);
          }

          const sources: Source[] = await getSourcesFromChunks(chunks);
          queueIndicator({
            controller,
            status: `Collected ${sources.length} resources for your study plan`,
            icon: "documents",
          });
          const citations: Citation[] = await getCitationsFromChunks(chunks);
          const contextFromSources = await getContextFromSources(sources);
          const systemPrompt =
            RESPOND_TO_STUDY_PLAN_SYSTEM_PROMPT(contextFromSources);
          queueIndicator({
            controller,
            status: "Creating a personalized study plan",
            icon: "thinking",
          });
          queueAssistantResponse({
            controller,
            providers,
            providerName: PROVIDER_NAME,
            messages: stripMessagesOfCitations(
              chat.messages.slice(-HISTORY_CONTEXT_LENGTH)
            ),
            model_name: MODEL_NAME,
            systemPrompt,
            citations,
            error_message: DEFAULT_RESPONSE_MESSAGE,
            temperature: STUDY_PLAN_TEMPERATURE,
          });
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        } catch (error: any) {
          console.error("Error in respondToStudyPlanRequest:", error);
          queueError({
            controller,
            error_message: error.message ?? DEFAULT_RESPONSE_MESSAGE,
          });
          queueAssistantResponse({
            controller,
            providers,
            providerName: PROVIDER_NAME,
            messages: [],
            model_name: MODEL_NAME,
            systemPrompt: RESPOND_TO_STUDY_PLAN_BACKUP_SYSTEM_PROMPT(),
            citations: [],
            error_message: DEFAULT_RESPONSE_MESSAGE,
            temperature: STUDY_PLAN_TEMPERATURE,
          });
        }
      },
    });
  
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }
  
  static async respondToDocumentSummaryRequest(
    chat: Chat,
    providers: AIProviders,
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    index: any
  ): Promise<Response> {
    /**
     * Respond to the user when they request a document summary
     */
    const PROVIDER_NAME: ProviderName = DOCUMENT_SUMMARY_PROVIDER;
    const MODEL_NAME: string = DOCUMENT_SUMMARY_MODEL;
  
    const stream = new ReadableStream({
      async start(controller) {
        queueIndicator({
          controller,
          status: "Identifying document to summarize",
          icon: "understanding",
        });
        try {
          const hypotheticalData: string = await generateHypotheticalData(
            chat,
            providers.openai
          );
          const { embedding }: { embedding: number[] } =
            await embedHypotheticalData(hypotheticalData, providers.openai);
          
          const lastUserMessage = chat.messages
            .filter(msg => msg.role === "user")
            .pop()?.content || "";
  
          // Check if a specific document was referenced
          const referencedDocId = await ResponseModule.findReferencedDocument(lastUserMessage);
  
          // Use different search strategies based on document reference
          let chunks: Chunk[];
          if (referencedDocId) {
            queueIndicator({
              controller,
              status: "Looking specifically in the referenced document",
              icon: "searching",
            });
            
            chunks = await searchForChunksWithFilter(
              embedding, 
              index,
              { source_url: { $eq: referencedDocId } }
            );
            
            // If no relevant chunks found, fall back to regular search
            if (chunks.length === 0) {
              queueIndicator({
                controller,
                status: "Expanding search to all documents",
                icon: "searching",
              });
              chunks = await searchForChunksUsingEmbedding(embedding, index);
            }
          } else {
            queueIndicator({
              controller,
              status: "Reading through documents",
              icon: "searching",
            });
            chunks = await searchForChunksUsingEmbedding(embedding, index);
          }

          const sources: Source[] = await getSourcesFromChunks(chunks);
          queueIndicator({
            controller,
            status: `Retrieved ${sources.length} document sections`,
            icon: "documents",
          });
          const citations: Citation[] = await getCitationsFromChunks(chunks);
          const contextFromSources = await getContextFromSources(sources);
          const systemPrompt =
            RESPOND_TO_DOCUMENT_SUMMARY_SYSTEM_PROMPT(contextFromSources);
          queueIndicator({
            controller,
            status: "Generating a comprehensive summary",
            icon: "thinking",
          });
          queueAssistantResponse({
            controller,
            providers,
            providerName: PROVIDER_NAME,
            messages: stripMessagesOfCitations(
              chat.messages.slice(-HISTORY_CONTEXT_LENGTH)
            ),
            model_name: MODEL_NAME,
            systemPrompt,
            citations,
            error_message: DEFAULT_RESPONSE_MESSAGE,
            temperature: DOCUMENT_SUMMARY_TEMPERATURE,
          });
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        } catch (error: any) {
          console.error("Error in respondToDocumentSummaryRequest:", error);
          queueError({
            controller,
            error_message: error.message ?? DEFAULT_RESPONSE_MESSAGE,
          });
          queueAssistantResponse({
            controller,
            providers,
            providerName: PROVIDER_NAME,
            messages: [],
            model_name: MODEL_NAME,
            systemPrompt: RESPOND_TO_DOCUMENT_SUMMARY_BACKUP_SYSTEM_PROMPT(),
            citations: [],
            error_message: DEFAULT_RESPONSE_MESSAGE,
            temperature: DOCUMENT_SUMMARY_TEMPERATURE,
          });
        }
      },
    });
  
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Add this function to the ResponseModule class
  static async findReferencedDocument(message: string): Promise<string | null> {
    // Get list of all documents
    const documents = await getDocuments();
    
    if (documents.length === 0) {
      return null;
    }
    
    // Try to find a document mention in the message
    for (const doc of documents) {
      // Create a regex that will match even partial document names
      // Remove file extension for better matching
      const baseTitle = doc.title.replace(/\.[^/.]+$/, "");
      const cleanTitle = baseTitle.replace(/[^\w\s]/g, '').trim();
      const titleWords = cleanTitle.split(/\s+/).filter(word => word.length > 3);
      
      // If multiple significant words match, consider it a reference
      const matchCount = titleWords.filter(word => 
        new RegExp(`\\b${word}\\b`, 'i').test(message)
      ).length;
      
      if (matchCount >= Math.min(2, titleWords.length)) {
        console.log(`Found document reference: ${doc.title} (matched ${matchCount} words)`);
        return doc.id;
      }
    }
    
    return null;
  }

}