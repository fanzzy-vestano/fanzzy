import imageManifest from "./generated/storefront-images.json";

type ImageCopy = { src: string; width: number; height: number };
const copiesBySource: Record<string, ImageCopy[]> = imageManifest;
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Match the full original URL: replacing an image in Admin immediately uses
// the new upload, even when it has not yet had a local display copy generated.
export function storefrontImageProps(source: string, sizes: string) {
  const copies = copiesBySource[source];
  if (!copies?.length) return { src: source };
  const largest = copies[copies.length - 1];
  return {
    src: `${basePath}${largest.src}`,
    srcSet: copies.map((copy) => `${basePath}${copy.src} ${copy.width}w`).join(", "),
    sizes,
    width: largest.width,
    height: largest.height,
  };
}
