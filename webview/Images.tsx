import { useRef, useState, type ClipboardEvent } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { IMAGE_LIMITS, imageUrl, type ImageAttachment } from '../src/shared/images';
import './images.css';
export function ImageGallery({
  images = [],
  onRemove,
}: {
  images?: ImageAttachment[];
  onRemove?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<string>();
  return (
    <div className="image-gallery">
      {images.map((image) => (
        <figure key={image.id} className={expanded === image.id ? 'expanded' : ''}>
          <button
            type="button"
            className="image-preview"
            aria-label={`Agrandir ${image.name}`}
            onClick={() => setExpanded(expanded === image.id ? undefined : image.id)}
          >
            <img src={imageUrl(image)} alt={image.name} />
          </button>
          <figcaption>{image.name}</figcaption>
          {onRemove && (
            <button
              type="button"
              className="image-remove"
              aria-label={`Retirer ${image.name}`}
              onClick={() => onRemove(image.id)}
            >
              <X size={14} />
            </button>
          )}
        </figure>
      ))}
    </div>
  );
}
export function useImageDraft() {
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const add = async (files: File[]) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      if (files.length + images.length > IMAGE_LIMITS.count)
        throw Error('Ajoute au maximum 4 images par envoi.');
      const added: ImageAttachment[] = [];
      for (const file of files) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
          throw Error('Formats acceptés : PNG, JPEG et WebP.');
        if (file.size > 20 * 1024 * 1024)
          throw Error('L’image dépasse 20 Mo. Réduis-la avant de l’ajouter.');
        const bitmap = await createImageBitmap(file);
        try {
          const ratio = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
          canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
          const context = canvas.getContext('2d');
          if (!context) throw Error('Lecture de l’image indisponible.');
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          let url = canvas.toDataURL('image/png');
          if (url.length > (IMAGE_LIMITS.bytes * 4) / 3) url = canvas.toDataURL('image/jpeg', 0.9);
          const [header, data] = url.split(',');
          if (data.length > Math.ceil(IMAGE_LIMITS.bytes / 3) * 4)
            throw Error('Image trop détaillée : réduis sa taille avant de l’ajouter.');
          added.push({
            id: crypto.randomUUID(),
            name: (file.name || 'capture.png').replace(/[\\/\x00-\x1f]/g, '-').slice(0, 200),
            mimeType: header.includes('jpeg') ? 'image/jpeg' : 'image/png',
            data,
          });
        } finally {
          bitmap.close();
        }
      }
      setImages((current) => [...current, ...added]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };
  const onPaste = (event: ClipboardEvent) => {
    const files = Array.from(event.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      void add(files);
    }
  };
  return { images, setImages, error, loading, add, onPaste };
}
export function ImagePicker({
  draft,
  disabled,
}: {
  draft: ReturnType<typeof useImageDraft>;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="image-picker">
      <ImageGallery
        images={draft.images}
        onRemove={
          disabled || draft.loading
            ? undefined
            : (id) => draft.setImages((images) => images.filter((i) => i.id !== id))
        }
      />
      <input
        ref={input}
        type="file"
        aria-label="Ajouter des images"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        disabled={disabled || draft.loading}
        onChange={(e) => {
          void draft.add(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className="text-button"
        disabled={disabled || draft.loading}
        onClick={() => input.current?.click()}
      >
        <ImagePlus size={16} />
        {draft.loading ? 'Préparation…' : 'Joindre une image'}
      </button>
      <small>
        Ou colle une capture dans le texte · Modèle compatible avec les images requis · 4 images
        maximum · redimensionnées à 2 048 px.
      </small>
      {draft.error && (
        <p role="alert" className="inline-error">
          {draft.error}
        </p>
      )}
    </div>
  );
}
