import { HYDE_MODEL, HYDE_TEMPERATURE } from "@/configuration/models";
import { QUESTION_RESPONSE_TOP_K } from "@/configuration/pinecone";
import {
  HYDE_PROMPT,
  RESPOND_TO_QUESTION_SYSTEM_PROMPT,
} from "@/configuration/prompts";
import { chunkSchema, citationSchema } from "@/types";

import type {
  Chat,
  Chunk,
  Citation,
  CoreMessage,
  DisplayMessage,
  Source,
} from "@/types";
import type OpenAI from "openai";

export function stripMessagesOfCitations(
  messages: DisplayMessage[]
): DisplayMessage[] {
  return messages.map((msg) => ({
    ...msg,
    content: msg.content.replace(/\[\d+\]/g, ""),
  }));
}

export function convertToCoreMessages(
  messages: DisplayMessage[]
): CoreMessage[] {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));
}

export function addSystemMessage(
  messages: CoreMessage[],
  systemMessage: string
): CoreMessage[] {
  return [{ role: "system", content: systemMessage }, ...messages];
}

export async function embedHypotheticalData(
  value: string,
  openai: OpenAI
): Promise<{ embedding: number[] }> {
  try {
    const embedding = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: value,
    });

    return { embedding: embedding.data[0].embedding };
  } catch (error) {
    throw new Error("Error embedding hypothetical data");
  }
}

// Hypothetical Document Embedding (HyDe)
export async function generateHypotheticalData(
  chat: Chat,
  openai: OpenAI
): Promise<string> {
  try {
    // console.log(
    //   "Generating hypothetical data...",
    //   HYDE_MODEL,
    //   HYDE_TEMPERATURE,
    //   HYDE_PROMPT(chat)
    // );
    const response = await openai.chat.completions.create({
      model: HYDE_MODEL,
      temperature: HYDE_TEMPERATURE,
      messages: await convertToCoreMessages([
        {
          role: "system",
          content: HYDE_PROMPT(chat),
          citations: [],
        },
      ]),
    });

    return response.choices[0].message.content ?? "";
  } catch (error) {
    console.error("Error generating hypothetical data:", error);
    throw new Error("Error generating hypothetical data");
  }
}

export async function searchForChunksUsingEmbedding(
  embedding: number[],
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  pineconeIndex: any
): Promise<Chunk[]> {
  try {
    // First try to search only in uploaded documents (if we have any)
    // This gives priority to custom documents
    const { matches: customMatches } = await pineconeIndex.query({
      vector: embedding,
      topK: QUESTION_RESPONSE_TOP_K,
      includeMetadata: true,
      filter: {
        // This assumes your document IDs are UUIDs
        // You may need to adjust the filter based on how you identify uploaded documents
        source_url: { $exists: true }
      }
    });
    
    // If we found relevant chunks in custom documents, return them
    if (customMatches && customMatches.length > 0) {
      console.log(`Found ${customMatches.length} matches in custom documents`);
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      return customMatches.map((match: any) =>
        chunkSchema.parse({
          text: match.metadata?.text ?? "",
          pre_context: match.metadata?.pre_context ?? "",
          post_context: match.metadata?.post_context ?? "",
          source_url: match.metadata?.source_url ?? "",
          source_description: match.metadata?.source_description ?? "",
          order: match.metadata?.order ?? 0,
        })
      );
    }
    
    // Fall back to a broader search if nothing was found
    const { matches } = await pineconeIndex.query({
      vector: embedding,
      topK: QUESTION_RESPONSE_TOP_K,
      includeMetadata: true,
    });

    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    return matches.map((match: any) =>
      chunkSchema.parse({
        text: match.metadata?.text ?? "",
        pre_context: match.metadata?.pre_context ?? "",
        post_context: match.metadata?.post_context ?? "",
        source_url: match.metadata?.source_url ?? "",
        source_description: match.metadata?.source_description ?? "",
        order: match.metadata?.order ?? 0,
      })
    );
  } catch (error) {
    console.error("Error in searchForChunksUsingEmbedding:", error);
    throw new Error(
      "Error searching for chunks using embedding. Double check Pinecone index name and API key."
    );
  }
}

export function aggregateSources(chunks: Chunk[]): Source[] {
  const sourceMap = new Map<string, Source>();

  for (const chunk of chunks) {
    if (!sourceMap.has(chunk.source_url)) {
      sourceMap.set(chunk.source_url, {
        chunks: [],
        source_url: chunk.source_url,
        source_description: chunk.source_description,
      });
    }
    
    const source = sourceMap.get(chunk.source_url);
    if (source) {
      source.chunks.push(chunk);
    }
  }

  return Array.from(sourceMap.values());
}

export function sortChunksInSourceByOrder(source: Source): Source {
  source.chunks.sort((a, b) => a.order - b.order);
  return source;
}

export function getSourcesFromChunks(chunks: Chunk[]): Source[] {
  const sources = aggregateSources(chunks);
  return sources.map((source) => sortChunksInSourceByOrder(source));
}

export function buildContextFromOrderedChunks(
  chunks: Chunk[],
  citationNumber: number
): string {
  let context = "";
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    context += chunk.pre_context;
    context += ` ${chunk.text} [${citationNumber}] `;
    if (
      i === chunks.length - 1 ||
      chunk.post_context !== chunks[i + 1].pre_context
    ) {
      context += chunk.post_context;
    }
    if (i < chunks.length - 1) {
      context += "\n\n";
    }
  }
  return context.trim();
}

export function getContextFromSource(
  source: Source,
  citationNumber: number
): string {
  return `
    <excerpt>
    Source Description: ${source.source_description}
    Source Citation: [${citationNumber}]
    Excerpt from Source [${citationNumber}]:
    ${buildContextFromOrderedChunks(source.chunks, citationNumber)}
    </excerpt>
  `;
}

export function getContextFromSources(sources: Source[]): string {
  return sources
    .map((source, index) => getContextFromSource(source, index + 1))
    .join("\n\n\n");
}

export function buildPromptFromContext(context: string): string {
  // TODO: yes, this is redundant
  return RESPOND_TO_QUESTION_SYSTEM_PROMPT(context);
}

export function getCitationsFromChunks(chunks: Chunk[]): Citation[] {
  return chunks.map((chunk) =>
    citationSchema.parse({
      source_url: chunk.source_url,
      source_description: chunk.source_description,
    })
  );
}

export async function searchForChunksWithFilter(
  embedding: number[],
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  pineconeIndex: any,
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  filter: any
): Promise<Chunk[]> {
  try {
    const { matches } = await pineconeIndex.query({
      vector: embedding,
      topK: QUESTION_RESPONSE_TOP_K,
      includeMetadata: true,
      filter: filter
    });

    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    return matches.map((match: any) =>
      chunkSchema.parse({
        text: match.metadata?.text ?? "",
        pre_context: match.metadata?.pre_context ?? "",
        post_context: match.metadata?.post_context ?? "",
        source_url: match.metadata?.source_url ?? "",
        source_description: match.metadata?.source_description ?? "",
        order: match.metadata?.order ?? 0,
      })
    );
  } catch (error) {
    console.error("Error in searchForChunksWithFilter:", error);
    return [];
  }
}