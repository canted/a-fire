import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { File as NativeFile, Paths } from "expo-file-system";
import { randomUuid } from "./randomId";
import type { ChatAttachment } from "./chatComposition";

export function browserChatFile(file: File): ChatAttachment {
  return {
    id: randomUuid(),
    uri: URL.createObjectURL(file),
    file,
    name: file.name,
    type: file.type,
    size: file.size,
  };
}
export async function pickChatFile(
  kind: "file" | "photo" | "camera" = "file",
): Promise<ChatAttachment | undefined> {
  if (kind !== "file") {
    if (
      kind === "camera" &&
      Platform.OS !== "web" &&
      !(await ImagePicker.requestCameraPermissionsAsync()).granted
    )
      throw new Error(
        "Camera access is off. Allow it in device settings, or choose a file.",
      );
    const result =
      kind === "camera"
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            quality: 1,
            allowsEditing: false,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images", "videos"],
            quality: 1,
            allowsEditing: false,
            allowsMultipleSelection: false,
          });
    if (result.canceled) return;
    const asset = result.assets[0];
    return {
      id: randomUuid(),
      uri: asset.uri,
      name:
        asset.fileName || (asset.type === "video" ? "Video.mp4" : "Photo.jpg"),
      type:
        asset.mimeType || (asset.type === "video" ? "video/mp4" : "image/jpeg"),
      size: asset.fileSize ?? 0,
      file: asset.file,
      width: asset.width,
      height: asset.height,
    };
  }
  const result = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
    base64: false,
  });
  if (result.canceled) return;
  const asset = result.assets[0];
  return {
    id: randomUuid(),
    uri: asset.uri,
    name: asset.name,
    type: asset.mimeType || "application/octet-stream",
    size: asset.size ?? 0,
    file: asset.file,
  };
}
export function releaseChatFile(file?: ChatAttachment) {
  if (Platform.OS === "web" && file?.uri.startsWith("blob:"))
    URL.revokeObjectURL(file.uri);
  if (Platform.OS !== "web" && file?.uri.startsWith(Paths.cache.uri)) {
    try {
      const cached = new NativeFile(file.uri);
      if (cached.exists) cached.delete();
    } catch {
      /* OS cache eviction is harmless. */
    }
  }
}

/** One byte-backed multipart adapter for picked files across native features. */
export function appendPickedFile(
  form: FormData,
  field: string,
  file: ChatAttachment,
  mime = file.type,
) {
  if (Platform.OS === "web") {
    if (!file.file) throw new Error("Choose the file again before uploading.");
    form.append(field, file.file);
  } else {
    const local = new NativeFile(file.uri);
    form.append(field, {
      name: file.name,
      type: mime,
      bytes: () => local.bytes(),
    } as unknown as Blob);
  }
}
