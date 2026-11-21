export interface Tracked<R, S extends object> {
  value: R;
  dependencies: ["*"] | (keyof S)[];
}

export function trackSelector<S extends object, R>(
  state: S,
  selector: (state: S) => R
): Tracked<R, S> {
  const keys = new Set<keyof S>();
  let all = false;

  const proxy = new Proxy(state, {
    get(target, property, receiver) {
      if (property in target) keys.add(property as keyof S);
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      if (property in target) keys.add(property as keyof S);
      return Reflect.has(target, property);
    },
    ownKeys(target) {
      all = true;
      return Reflect.ownKeys(target);
    },
  });

  return {
    value: selector(proxy),
    dependencies: all ? ["*"] : Array.from(keys),
  };
}

export function sameDependencies<S extends object>(
  left: ["*"] | (keyof S)[],
  right: ["*"] | (keyof S)[]
) {
  if (left.length !== right.length) return false;
  if (left[0] === "*" || right[0] === "*") return left[0] === right[0];
  const rightKeys = right as (keyof S)[];
  return (left as (keyof S)[]).every((key) => rightKeys.includes(key));
}
