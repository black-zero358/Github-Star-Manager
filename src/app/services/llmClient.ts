export type LLMConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  pass1Prompt?: string;
  pass1StrictPrompt?: string;
  pass2Prompt?: string;
  pass1PromptZh?: string;
  pass1StrictPromptZh?: string;
  pass2PromptZh?: string;
  pass1PromptWithExisting?: string;
  pass1PromptNoNewWithExisting?: string;
  pass1StrictPromptWithExisting?: string;
  pass1StrictNoNewWithExisting?: string;
  pass1PromptWithExistingZh?: string;
  pass1PromptNoNewWithExistingZh?: string;
  pass1StrictPromptWithExistingZh?: string;
  pass1StrictNoNewWithExistingZh?: string;
  pass2PromptWithExisting?: string;
  pass2PromptWithExistingZh?: string;
};

export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function requestCompletion(
  config: LLMConfig,
  messages: LLMMessage[],
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      messages,
    }),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `LLM request failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("LLM response missing content");
  }

  return content;
}
