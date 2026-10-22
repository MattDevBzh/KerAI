import { imageSize } from 'image-size';
import type { ModelInfo } from '@github/copilot-sdk';
import { imagesSchema } from '../core/imageSchemas';
import { IMAGE_LIMITS, type ImageAttachment } from '../shared/images';
export class ImageInputError extends Error {}
export function validateImages(value?: ImageAttachment[]): ImageAttachment[] {
  const images = imagesSchema.parse(value ?? []);
  for (const image of images) {
    const bytes = Buffer.from(image.data, 'base64');
    if (bytes.length > IMAGE_LIMITS.bytes || bytes.toString('base64') !== image.data)
      throw Error('Image trop volumineuse ou encodage invalide.');
    const size = imageSize(bytes);
    if (
      `image/${size.type === 'jpg' ? 'jpeg' : size.type}` !== image.mimeType ||
      !size.width ||
      !size.height ||
      size.width * size.height > IMAGE_LIMITS.pixels
    )
      throw Error('Format ou dimensions de l’image non autorisés.');
  }
  return structuredClone(images);
}
export function imageAttachments(images?: ImageAttachment[]) {
  return validateImages(images).map(({ name, mimeType, data }) => ({
    type: 'blob' as const,
    displayName: name,
    mimeType,
    data,
  }));
}
export function assertVision(model: ModelInfo | undefined, images?: ImageAttachment[]) {
  if (!images?.length) return;
  validateImages(images);
  if (!model?.capabilities?.supports.vision)
    throw new ImageInputError(
      'Choisis un modèle compatible avec les images. Aucun envoi n’a été effectué.',
    );
  const limits = model.capabilities.limits?.vision;
  if (
    limits &&
    (images.length > limits.max_prompt_images ||
      images.some(
        (image) =>
          !limits.supported_media_types.includes(image.mimeType) ||
          Buffer.from(image.data, 'base64').length > limits.max_prompt_image_size,
      ))
  )
    throw new ImageInputError('Ces images dépassent les formats ou limites du modèle choisi.');
}
