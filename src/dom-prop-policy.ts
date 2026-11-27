import { nexusDOMError } from "./errors.js";

const rawHTML = new Set(["innerhtml", "outerhtml", "srcdoc", "dangerouslysetinnerhtml"]);
const urlAttributes = new Set([
  "href", "src", "action", "formaction", "poster", "xlink:href", "xlinkhref",
]);
const allowedProtocols = new Set(["http:", "https:", "mailto:", "tel:"]);
const validationBase = "https://nexus.invalid/";

export const isEventProperty = (property: string) => /^on[A-Z]/.test(property);

export function checkedDOMValue(element: string, property: string, value: unknown) {
  const name = property.toLowerCase();
  if (rawHTML.has(name) || name.startsWith("on")) {
    throw nexusDOMError(
      "UNSAFE_DOM_PROPERTY",
      `Cannot use "${property}" as a DOM property. Use JSX children or a function event handler.`
    );
  }
  if (typeof value === "boolean" && name.startsWith("aria-")) {
    return String(value);
  }
  if (
    value === null ||
    value === undefined ||
    value === false ||
    value === true ||
    (!urlAttributes.has(name) && !(name === "data" && element.toLowerCase() === "object"))
  ) {
    return value;
  }

  const url = String(value);
  let protocol: string | undefined;
  try {
    protocol = new URL(url, validationBase).protocol;
  } catch {
    // Invalid URLs use the same library error as unsupported schemes.
  }
  if (!protocol || !allowedProtocols.has(protocol)) {
    throw nexusDOMError(
      "UNSAFE_DOM_URL",
      `"${property}" requires a relative URL or an http, https, mailto or tel URL.`
    );
  }
  // Assign the same string that was checked, including for URL-like objects.
  return url;
}
