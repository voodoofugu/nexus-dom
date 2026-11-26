import { checkedDOMValue } from "./dom-prop-policy.js";

export { isEventProperty } from "./dom-prop-policy.js";

export const eventName = (property: string) =>
  property.slice(2).toLowerCase();

export const formatText = (value: unknown) =>
  value === null || value === undefined || value === false ? "" : String(value);

function writeStyle(
  element: HTMLElement | SVGElement,
  value: unknown,
  previous: unknown
) {
  if (typeof value === "string") {
    element.style.cssText = value;
    return;
  }

  if (!value || typeof value !== "object") {
    element.removeAttribute("style");
    return;
  }

  if (previous && typeof previous === "object") {
    for (const property of Object.keys(previous)) {
      if (!(property in value)) {
        element.style.removeProperty(property);
        (element.style as unknown as Record<string, string>)[property] = "";
      }
    }
  }

  for (const [property, next] of Object.entries(value)) {
    if (property.startsWith("--")) {
      element.style.setProperty(property, String(next));
    } else {
      (element.style as unknown as Record<string, string | number>)[property] =
        next as string | number;
    }
  }
}

export function writeProperty(
  element: Element,
  property: string,
  input: unknown,
  previous: unknown
) {
  const value = checkedDOMValue(element.localName, property, input);
  if (property === "className" || property === "class") {
    if (value === null || value === undefined || value === false) {
      element.removeAttribute("class");
    } else {
      element.setAttribute("class", String(value));
    }
    return;
  }

  if (
    property === "style" &&
    (element instanceof HTMLElement || element instanceof SVGElement)
  ) {
    writeStyle(element as HTMLElement | SVGElement, value, previous);
    return;
  }

  if (property === "htmlFor") {
    if (value === null || value === undefined || value === false) {
      element.removeAttribute("for");
    } else {
      element.setAttribute("for", String(value));
    }
    return;
  }

  const shouldUseAttribute =
    property.startsWith("aria-") ||
    property.startsWith("data-") ||
    element.namespaceURI === "http://www.w3.org/2000/svg";

  if (!shouldUseAttribute && property in element) {
    (element as unknown as Record<string, unknown>)[property] =
      value === null || value === undefined ? "" : value;
    return;
  }

  if (value === null || value === undefined || value === false) {
    element.removeAttribute(property);
  } else if (value === true) {
    element.setAttribute(property, "");
  } else {
    element.setAttribute(property, String(value));
  }
}
