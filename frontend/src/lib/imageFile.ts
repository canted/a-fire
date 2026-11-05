import { IMAGE_ACCEPT, IMAGE_UPLOAD_MAX_BYTES } from "../../../types/image-policy"
export { IMAGE_ACCEPT }

export function assertImageFile(file: Pick<File, "size" | "type">) {
  if (file.size > IMAGE_UPLOAD_MAX_BYTES) throw new Error("Images must be 20 MB or smaller.")
  if (!IMAGE_ACCEPT.split(",").includes(file.type)) throw new Error("Use a JPEG, PNG, WebP, GIF, or AVIF image.")
}
