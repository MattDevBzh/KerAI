/** Explicit user attachments. Data is kept in private session storage, never in prompts/logs. */
export interface ImageAttachment {
  id: string;
  name: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  data: string;
}
export const IMAGE_LIMITS = { count: 4, bytes: 2 * 1024 * 1024, pixels: 16_000_000 };
export const imageUrl = (image: ImageAttachment) => `data:${image.mimeType};base64,${image.data}`;
