export type TextContent = { type: "text"; text: string };
export type ImageContent = { type: "image"; data: string; mimeType: string };

export function textResult<T extends { text: string }>(input: T) {
  return { structuredContent: input, content: [{ type: "text", text: input.text } satisfies TextContent] };
}

export function imageResult<T extends { data: string; mimeType: string }>(input: T) {
  const { data, mimeType, ...metadata } = input;
  return {
    structuredContent: { mimeType, ...metadata },
    content: [{ type: "image", data, mimeType } satisfies ImageContent],
  };
}
