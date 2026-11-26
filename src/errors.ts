export type NexusDOMErrorCode =
  | "APP_DISPOSED"
  | "CLEANUP_OUTSIDE_COMPONENT"
  | "DUPLICATE_LIST_KEY"
  | "INVALID_LIST_INDEX"
  | "INVALID_LIST_REMOVE_COUNT"
  | "RENDER_TARGET_NOT_FOUND"
  | "STORE_VIEW_OUTSIDE_APP"
  | "STORE_DEPENDENCY_CONFLICT"
  | "STORE_DEPENDENCY_CYCLE"
  | "ID_OUTSIDE_COMPONENT"
  | "ID_HASH_COLLISION"
  | "HYDRATION_MISMATCH"
  | "HYDRATION_STATE_INVALID"
  | "HYDRATION_STATE_LATE"
  | "INVALID_SERVER_ELEMENT"
  | "INVALID_SERVER_ATTRIBUTE"
  | "UNSAFE_DOM_PROPERTY"
  | "UNSAFE_DOM_URL";

/** An actionable error raised by nexus-dom itself, not by user render code. */
export class NexusDOMError extends Error {
  override readonly name = "nexus-dom";

  constructor(
    readonly code: NexusDOMErrorCode,
    message: string
  ) {
    super(`[${code}]\n${message}`);
  }
}

export function nexusDOMError(code: NexusDOMErrorCode, message: string) {
  return new NexusDOMError(code, message);
}
