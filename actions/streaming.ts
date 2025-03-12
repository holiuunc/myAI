import type OpenAI from "openai";
import type {
  CoreMessage,
  StreamedLoading,
  StreamedMessage,
  IndicatorIconType,
  StreamedDone,
  AIProviders,
  ProviderName,
  Citation,
  StreamedError,
} from "@/types";
import type Anthropic from "@anthropic-ai/sdk";

export interface QueueAssistantResponseParams {
  controller: ReadableStreamDefaultController;
  providers: AIProviders;
  providerName: ProviderName;
  messages: CoreMessage[];
  model_name: string;
  systemPrompt: string;
  citations: Citation[];
  error_message: string;
  temperature: number;
}

export async function handleOpenAIStream({
  controller,
  providers,
  providerName,
  messages,
  model_name,
  systemPrompt,
  citations,
  temperature,
}: QueueAssistantResponseParams) {
  let client: OpenAI = providers.openai;
  if (providerName === "fireworks") {
    client = providers.fireworks;
    console.log("Streaming Fireworks response...", {
      temperature,
      model_name,
      systemPrompt,
      messages,
    });
  } else {
    console.log("Streaming OpenAI response...", {
      temperature,
      model_name,
      systemPrompt,
      messages,
    });
  }
  const startTime = Date.now();
  const streamedResponse = await client.chat.completions.create({
    model: model_name,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    stream: true,
    temperature,
  });
  if (!streamedResponse) {
    throw new Error("No stream response");
  }
  let responseBuffer = "";

  for await (const chunk of streamedResponse) {
    responseBuffer += chunk.choices[0]?.delta.content ?? "";
    const streamedMessage: StreamedMessage = {
      type: "message",
      message: {
        role: "assistant",
        content: responseBuffer,
        citations,
      },
    };
    controller.enqueue(
      new TextEncoder().encode(`${JSON.stringify(streamedMessage)}\n`)
    );
  }
  const endTime = Date.now();
  const streamDuration = endTime - startTime;
  console.log(`Done streaming OpenAI response in ${streamDuration / 1000}s`);
  const donePayload: StreamedDone = {
    type: "done",
    final_message: responseBuffer,
  };
  controller.enqueue(
    new TextEncoder().encode(`${JSON.stringify(donePayload)}\n`)
  );
  controller.close();
}

export async function handleAnthropicStream({
  controller,
  providers,
  messages,
  model_name,
  systemPrompt,
  citations,
  temperature,
}: QueueAssistantResponseParams) {
  const anthropicClient: Anthropic = providers.anthropic;
  const anthropicMessages: Anthropic.Messages.MessageParam[] = messages.map(
    (msg) => ({
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content,
    })
  );
  let responseBuffer = "";
  console.log("Streaming Anthropic response...", {
    temperature,
    model_name,
    systemPrompt,
    messages,
  });
  await anthropicClient.messages
    .stream({
      messages: anthropicMessages,
      model: model_name,
      system: systemPrompt,
      max_tokens: 4096,
      temperature,
    })
    .on("text", (textDelta) => {
      responseBuffer += textDelta;
      const streamedMessage: StreamedMessage = {
        type: "message",
        message: {
          role: "assistant",
          content: responseBuffer,
          citations,
        },
      };
      controller.enqueue(
        new TextEncoder().encode(`${JSON.stringify(streamedMessage)}\n`)
      );
    })
    .on("end", () => {
      const donePayload: StreamedDone = {
        type: "done",
        final_message: responseBuffer,
      };
      controller.enqueue(
        new TextEncoder().encode(`${JSON.stringify(donePayload)}\n`)
      );
      controller.close();
    });
}

export async function queueAssistantResponse({
  controller,
  providers,
  providerName,
  messages,
  model_name,
  systemPrompt,
  citations,
  error_message,
  temperature,
}: QueueAssistantResponseParams) {
  if (providerName === "openai" || providerName === "fireworks") {
    console.log(providerName);
    await handleOpenAIStream({
      controller,
      providers,
      providerName,
      messages,
      model_name,
      systemPrompt,
      citations,
      error_message,
      temperature,
    });
  } else if (providerName === "anthropic") {
    await handleAnthropicStream({
      controller,
      providers,
      providerName,
      messages,
      model_name,
      systemPrompt,
      citations,
      error_message,
      temperature,
    });
  }
}

export interface QueueLoadingParams {
  controller: ReadableStreamDefaultController;
  status: string;
  icon: IndicatorIconType;
}

export async function queueIndicator({
  controller,
  status,
  icon,
}: QueueLoadingParams) {
  const loadingPayload: StreamedLoading = {
    type: "loading",
    indicator: {
      status: status,
      icon: icon,
    },
  };
  controller.enqueue(
    new TextEncoder().encode(`${JSON.stringify(loadingPayload)}\n`)
  );
}

export interface QueueErrorParams {
  controller: ReadableStreamDefaultController;
  error_message: string;
}

export async function queueError({
  controller,
  error_message,
}: QueueErrorParams) {
  const errorPayload: StreamedError = {
    type: "error",
    indicator: {
      status: error_message,
      icon: "error",
    },
  };
  controller.enqueue(
    new TextEncoder().encode(`${JSON.stringify(errorPayload)}\n`)
  );
  controller.close();
}
