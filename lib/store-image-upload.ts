// New category/banner uploads should not reintroduce multi-megabyte PNGs.
// Unsupported/animated formats and failed conversions keep the original file.
export async function prepareStoreImage(file: File, folder: string): Promise<File> {
  if ((folder !== "categories" && folder !== "homepage") ||
      !["image/jpeg", "image/png"].includes(file.type) ||
      typeof document === "undefined" || typeof createImageBitmap === "undefined") return file;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    const limit = folder === "homepage" ? 1920 : 960;
    const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.84));
    if (!blob || blob.size >= file.size || blob.type !== "image/webp") return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, { type: blob.type });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
