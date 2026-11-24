import { nexusDOMError } from "./errors.js";
import type { StoreSnapshot } from "./types.js";

const STATE_PREFIX = "nxs:s";

interface HydrationStatePayload {
  v: 1;
  stores: readonly StoreSnapshot[];
}

const assertJSONValue = (
  value: unknown,
  path: string,
  ancestors: Set<object>
): void => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw nexusDOMError(
      "HYDRATION_STATE_INVALID",
      `Hydration state at ${path} must be a finite number.`
    );
  }
  if (typeof value !== "object") {
    throw nexusDOMError(
      "HYDRATION_STATE_INVALID",
      `Hydration state at ${path} contains unsupported ${typeof value}.`
    );
  }
  if (ancestors.has(value)) {
    throw nexusDOMError(
      "HYDRATION_STATE_INVALID",
      `Hydration state at ${path} contains a cycle.`
    );
  }

  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    throw nexusDOMError(
      "HYDRATION_STATE_INVALID",
      `Hydration state at ${path} must contain only plain objects and arrays.`
    );
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      assertJSONValue(value[index], `${path}[${index}]`, ancestors);
    }
  } else {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw nexusDOMError(
        "HYDRATION_STATE_INVALID",
        `Hydration state at ${path} contains a symbol key.`
      );
    }
    for (const [key, item] of Object.entries(value)) {
      assertJSONValue(item, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
};

const isSnapshot = (value: unknown): value is StoreSnapshot => {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<StoreSnapshot>;
  if (
    Array.isArray(snapshot.keys) &&
    snapshot.keys.every((key) => typeof key === "string") &&
    !!snapshot.state &&
    typeof snapshot.state === "object" &&
    !Array.isArray(snapshot.state)
  ) {
    const keys = [...snapshot.keys].sort();
    const stateKeys = Object.keys(snapshot.state).sort();
    return (
      keys.length === stateKeys.length &&
      keys.every((key, index) => key === stateKeys[index])
    );
  }
  return false;
};

const parsePayload = (value: string): HydrationStatePayload => {
  let payload: unknown;
  try {
    payload = JSON.parse(value);
  } catch {
    throw nexusDOMError(
      "HYDRATION_STATE_INVALID",
      "Hydration state is not valid JSON."
    );
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    (payload as Partial<HydrationStatePayload>).v !== 1 ||
    !Array.isArray((payload as Partial<HydrationStatePayload>).stores) ||
    !(payload as HydrationStatePayload).stores.every(isSnapshot)
  ) {
    throw nexusDOMError(
      "HYDRATION_STATE_INVALID",
      "Hydration state does not match the supported versioned payload."
    );
  }
  return payload as HydrationStatePayload;
};

export const serializeHydrationState = (
  stores: readonly StoreSnapshot[]
) => {
  stores.forEach((snapshot, index) =>
    assertJSONValue(snapshot.state, `stores[${index}].state`, new Set())
  );
  let json: string;
  try {
    json = JSON.stringify({ v: 1, stores } satisfies HydrationStatePayload);
  } catch (error) {
    throw nexusDOMError(
      "HYDRATION_STATE_INVALID",
      `Hydration state could not be serialized: ${String(error)}`
    );
  }
  parsePayload(json);
  const safe = json
    .replace(/[<>&\u2028\u2029]/g, (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
    )
    .replaceAll("--", "-\\u002d");
  return `<!--${STATE_PREFIX}${safe}-->`;
};

export const takeHydrationState = (target: ParentNode) => {
  const markers = Array.from(target.childNodes).filter(
    (node): node is Comment =>
      node.nodeType === 8 &&
      (node.nodeValue ?? "").startsWith(STATE_PREFIX)
  );
  if (markers.length === 0) return undefined;
  if (markers.length !== 1) {
    throw nexusDOMError(
      "HYDRATION_STATE_INVALID",
      "Hydration root must contain at most one nxs:s payload."
    );
  }
  const marker = markers[0]!;
  const payload = parsePayload(
    (marker.nodeValue ?? "").slice(STATE_PREFIX.length)
  );
  marker.parentNode?.removeChild(marker);
  return payload.stores;
};
