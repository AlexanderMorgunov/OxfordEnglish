import { useState, type ImgHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

type PixelImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
  alt: string;
};

/** Pixel-art <img> — keeps hard edges when scaled, degrades gracefully if missing. */
export function PixelImage({ src, alt, className, ...props }: PixelImageProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn('[image-rendering:pixelated] select-none', className)}
      {...props}
    />
  );
}
